import { Dexie, type EntityTable } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import {
	createDekSyncPayloadCodec,
	type SyncPayloadCodec,
} from "./crypt";
import { useMe } from "./queries/auth";
import { useDb } from "../providers";
import type { DbHandle } from "./db";
import { queryKeyRoots, queryKeys } from "./queries/query-keys";
import {
	ClientFrame,
	type PushOp as WirePushOp,
	ServerFrame,
} from "../gen/sync/protocol";

// -------------------- types --------------------

type DirtyEntry = {
	id: string;
	_sync_hlc: string;
	_sync_is_deleted: number;
	plain_data: string;
};

type DeltaOp = {
	id: string;
	_sync_hlc: string;
	_sync_is_deleted: boolean;
	blob: string | Uint8Array;
	server_version: number;
};

type BootstrapResponse = {
	entries: DeltaOp[];
	next_cursor?: number;
	server_max_version: number;
};

type SyncTableName =
	| "categories"
	| "accounts"
	| "transactions"
	| "transaction_links";

type TableUpdateBucket = {
	ids: string[];
	maxHlc: string;
};

// -------------------- constants --------------------

const DIRTY_BATCH_LIMIT = 1000;
const BOOTSTRAP_PAGE_LIMIT = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;

async function toWsFrameBytes(raw: unknown): Promise<Uint8Array | null> {
	if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
	if (raw instanceof Uint8Array) return raw;
	if (raw instanceof Blob) return new Uint8Array(await raw.arrayBuffer());
	return null;
}

// -------------------- dirty row helpers --------------------

function createEmptyTableBuckets(): Record<SyncTableName, TableUpdateBucket> {
	return {
		categories: { ids: [], maxHlc: "" },
		accounts: { ids: [], maxHlc: "" },
		transactions: { ids: [], maxHlc: "" },
		transaction_links: { ids: [], maxHlc: "" },
	};
}

function resolveTargetTable(recordId: string): {
	tableName: SyncTableName;
	actualId: string;
} {
	const [tableNameRaw, actualId] = recordId.split(":");
	if (tableNameRaw === "category") {
		return { tableName: "categories", actualId };
	}
	return { tableName: `${tableNameRaw}s` as SyncTableName, actualId };
}

async function markDirtyEntriesSynced(db: DbHandle, dirty: DirtyEntry[]) {
	const updatesByTable = createEmptyTableBuckets();

	for (const record of dirty) {
		const { tableName, actualId } = resolveTargetTable(record.id);
		updatesByTable[tableName].ids.push(actualId);

		if (record._sync_hlc > updatesByTable[tableName].maxHlc) {
			updatesByTable[tableName].maxHlc = record._sync_hlc;
		}
	}

	for (const [tableName, data] of Object.entries(updatesByTable) as Array<
		[SyncTableName, TableUpdateBucket]
	>) {
		if (data.ids.length === 0) continue;

		const placeholders = data.ids.map(() => "?").join(",");

		if (tableName === "transaction_links") {
			await db.exec(
				`update transaction_links
				set _sync_status = 0
				where transaction_a_id || '_' || transaction_b_id IN (${placeholders})
				and _sync_hlc <= ?`,
				[...data.ids, data.maxHlc],
			);
		} else {
			await db.exec(
				`update ${tableName}
				set _sync_status = 0
				where id in (${placeholders})
				and _sync_hlc <= ?`,
				[...data.ids, data.maxHlc],
			);
		}
	}
}

async function getDirty({
	db,
	cursor,
}: {
	db: DbHandle;
	cursor: string | undefined;
}): Promise<{ entries: DirtyEntry[]; newCursor: string | undefined }> {
	const dirty = await db.query<DirtyEntry>(
		`
		select * from (
			select
				'category:' || id as id,
				_sync_hlc,
				_sync_is_deleted,
				json_object('created_at', created_at, 'updated_at', updated_at, 'name', name, 'is_neutral', is_neutral) as plain_data,
				1 as priority
			from categories where _sync_status = 1

			union all

			select
				'account:' || id as id,
				_sync_hlc,
				_sync_is_deleted,
				json_object('created_at', created_at, 'updated_at', updated_at, 'name', name) as plain_data,
				1 as priority
			from accounts where _sync_status = 1

			union all

			select
				'transaction:' || id as id,
				_sync_hlc,
				_sync_is_deleted,
				json_object('created_at', created_at, 'updated_at', updated_at, 'date', date, 'amount', amount, 'currency', currency, 'counter_party', counter_party, 'additional', additional, 'notes', notes, 'categorize_on', categorize_on, 'category_id', category_id, 'account_id', account_id) as plain_data,
				2 as priority
			from transactions where _sync_status = 1

			union all

			select
				'transaction_link:' || transaction_a_id || '_' || transaction_b_id as id,
				_sync_hlc,
				_sync_is_deleted,
				json_object('transaction_a_id', transaction_a_id, 'transaction_b_id', transaction_b_id, 'created_at', created_at) as plain_data,
				3 as priority
			from transaction_links where _sync_status = 1
		)
		${cursor ? `where _sync_hlc > ?` : ``}
		order by priority asc, _sync_hlc asc
		limit ?;
	`,
		cursor
			? [cursor, DIRTY_BATCH_LIMIT + 1]
			: [DIRTY_BATCH_LIMIT + 1],
	);

	if (!dirty.length) return { entries: [], newCursor: undefined };

	const hasMore = dirty.length === DIRTY_BATCH_LIMIT + 1;
	if (hasMore) dirty.pop();
	const newCursor = hasMore ? dirty.at(-1)?._sync_hlc : undefined;
	return { entries: dirty, newCursor };
}

// -------------------- applying incoming deltas --------------------

/**
 * Upsert incoming deltas into SQLite. Idempotent — uses HLC conflict check.
 * Returns the max server_version applied so the cursor can be advanced.
 */
async function applyIncomingOps({
	db,
	codec,
	ops,
}: {
	db: DbHandle;
	codec: SyncPayloadCodec;
	ops: DeltaOp[];
}): Promise<{ maxVersion: number | undefined; touchedTypes: Set<string> }> {
	if (!ops.length) return { maxVersion: undefined, touchedTypes: new Set() };

	const accounts: any[] = [];
	const accountsValues: string[] = [];

	const categories: any[] = [];
	const categoriesValues: string[] = [];

	const transactions: any[] = [];
	const transactionsValues: string[] = [];

	let maxVersion: number | undefined;
	const touchedTypes = new Set<string>();

		await Promise.all(
			ops.map(async (op) => {
				const entry =
					typeof op.blob === "string"
						? await codec.decode(op.blob)
						: await codec.decodeBytes(op.blob);
				if (!entry) return;

			if (maxVersion === undefined || op.server_version > maxVersion) {
				maxVersion = op.server_version;
			}

			const [type, id] = op.id.split(":");
			touchedTypes.add(type);
			switch (type) {
				case "account":
					accounts.push(
						/* id */ id,
						/* created_at */ entry.created_at,
						/* updated_at */ entry.updated_at,
						/* name */ entry.name,

						/* _sync_is_deleted */ op._sync_is_deleted ? 1 : 0,
						/* _sync_hlc */ db.hlc.receive(op._sync_hlc),
					);
					accountsValues.push("(?, ?, ?, ?, ?, ?, 0)");
					break;

				case "category":
					categories.push(
						/* id */ id,
						/* created_at */ entry.created_at,
						/* updated_at */ entry.updated_at,
						/* name */ entry.name,
						/* is_neutral */ entry.is_neutral,

						/* _sync_is_deleted */ op._sync_is_deleted ? 1 : 0,
						/* _sync_hlc */ db.hlc.receive(op._sync_hlc),
					);
					categoriesValues.push("(?, ?, ?, ?, ?, ?, ?, 0)");
					break;

				case "transaction":
					transactions.push(
						/* id */ id,
						/* created_at */ entry.created_at,
						/* updated_at */ entry.updated_at,
						/* date */ entry.date,
						/* amount */ entry.amount,
						/* currency */ entry.currency,
						/* counter_party */ entry.counter_party,
						/* additional */ entry.additional,
						/* notes */ entry.notes,
						/* categorize_on */ entry.categorize_on,
						/* category_id */ entry.category_id,
						/* account_id */ entry.account_id,

						/* _sync_is_deleted */ op._sync_is_deleted ? 1 : 0,
						/* _sync_hlc */ db.hlc.receive(op._sync_hlc),
					);
					transactionsValues.push(
						"(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
					);
					break;

				// transaction_links upsert is intentionally not handled here yet —
				// the prior pull code also skipped it.
			}
		}),
	);

	if (accounts.length) {
		await db.exec(
			`insert into accounts (
				id, created_at, updated_at, name,
				_sync_is_deleted, _sync_hlc, _sync_status
			)
			values ${accountsValues.join(",")}
			on conflict(id) do update set
				_sync_hlc = excluded._sync_hlc,
				_sync_is_deleted = excluded._sync_is_deleted,
				_sync_status = 0,
				name = excluded.name
			where excluded._sync_hlc > accounts._sync_hlc;`,
			accounts,
		);
	}

	if (categories.length) {
		await db.exec(
			`insert into categories (
				id, created_at, updated_at, name, is_neutral,
				_sync_is_deleted, _sync_hlc, _sync_status
			)
			values ${categoriesValues.join(",")}
			on conflict(id) do update set
				_sync_hlc = excluded._sync_hlc,
				_sync_is_deleted = excluded._sync_is_deleted,
				_sync_status = 0,
				name = excluded.name,
				is_neutral = excluded.is_neutral
			where excluded._sync_hlc > categories._sync_hlc;`,
			categories,
		);
	}

	if (transactions.length) {
		await db.exec(
			`insert into transactions (
				id, created_at, updated_at, date, amount, currency,
				counter_party, additional, notes, categorize_on,
				category_id, account_id,
				_sync_is_deleted, _sync_hlc, _sync_status
			)
			values ${transactionsValues.join(",")}
			on conflict(id) do update set
				_sync_hlc = excluded._sync_hlc,
				_sync_is_deleted = excluded._sync_is_deleted,
				_sync_status = 0,
				date = excluded.date,
				amount = excluded.amount,
				currency = excluded.currency,
				counter_party = excluded.counter_party,
				additional = excluded.additional,
				notes = excluded.notes,
				categorize_on = excluded.categorize_on,
				category_id = excluded.category_id,
				account_id = excluded.account_id
			where excluded._sync_hlc > transactions._sync_hlc;`,
			transactions,
		);
	}

	return { maxVersion, touchedTypes };
}

// -------------------- SyncClient --------------------

class SyncClient {
	private ws: WebSocket | null = null;
	private running = false;
	private reconnectAttempt = 0;
	private reconnectTimer: number | null = null;
	private pendingBatches = new Map<string, DirtyEntry[]>();
	private pushInFlight = false;
	private pushScheduledDuringInFlight = false;
	private codec: SyncPayloadCodec;

	constructor(
		private readonly db: DbHandle,
		dek: CryptoKey,
		private readonly getCursor: () => Promise<number | null>,
		private readonly setCursor: (c: number) => Promise<void>,
		private readonly resetCursorFn: (c: number) => Promise<void>,
		private readonly onEntitiesChanged: (types: Set<string>) => void,
	) {
		this.codec = createDekSyncPayloadCodec(dek);
	}

	start() {
		if (this.running) return;
		this.running = true;
		this.connect();
	}

	stop() {
		this.running = false;
		if (this.reconnectTimer != null) {
			window.clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		const ws = this.ws;
		this.ws = null;
		if (ws) ws.close();
		this.pendingBatches.clear();
	}

	/** Called by the React layer on mutation — push any dirty rows. */
	requestPush() {
		void this.pushDirtyLoop();
	}

	// ---------- connection ----------

	private connect() {
		if (!this.running) return;

		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		const url = `${proto}//${window.location.host}/api/v1/ws`;

		let ws: WebSocket;
		try {
			ws = new WebSocket(url);
		} catch (e) {
			console.warn("ws construct failed:", e);
			this.scheduleReconnect();
			return;
		}
		ws.binaryType = "arraybuffer";

		this.ws = ws;

		ws.onopen = () => {
			this.reconnectAttempt = 0;
			// Bootstrap historical data (paginated) and push any dirty rows.
			// Both run concurrently; upsert-by-HLC makes overlap harmless.
			this.runBootstrap().catch((e) =>
				console.error("bootstrap failed:", e),
			);
			this.pushDirtyLoop().catch((e) =>
				console.error("push-on-open failed:", e),
			);
		};

		ws.onmessage = (e) => {
			this.handleMessage(e.data).catch((err) =>
				console.error("handle msg:", err),
			);
		};

		ws.onclose = () => {
			if (this.ws === ws) this.ws = null;
			this.scheduleReconnect();
		};

		ws.onerror = () => {
			// onclose will fire; no-op here.
		};
	}

	private scheduleReconnect() {
		if (!this.running) return;
		if (this.reconnectTimer != null) return;
		const delay = Math.min(
			500 * 2 ** this.reconnectAttempt,
			MAX_RECONNECT_DELAY_MS,
		);
		this.reconnectAttempt++;
		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, delay);
	}

	// ---------- bootstrap ----------

	private async runBootstrap() {
		while (this.running) {
			const cursor = await this.getCursor();
			const params = new URLSearchParams();
			if (cursor != null) params.set("cursor", String(cursor));
			params.set("limit", String(BOOTSTRAP_PAGE_LIMIT));

			const res = await fetch(`/api/v1/bootstrap?${params}`, {
				method: "GET",
				credentials: "include",
			});
			if (!res.ok) {
				throw new Error(`bootstrap ${res.status}`);
			}
			const { entries, next_cursor, server_max_version } =
				(await res.json()) as BootstrapResponse;

			// Server-was-reset detection: if our cursor is ahead of the server's
			// max, our local data is authoritative. Reset cursor to the server's
			// view and mark all rows dirty so the push loop re-uploads them.
			if (cursor != null && cursor > server_max_version) {
				console.warn(
					`sync: cursor ${cursor} > server max ${server_max_version}, re-pushing all rows`,
				);
				await markAllRowsPendingPush(this.db);
				await this.resetCursorFn(server_max_version);
				this.requestPush();
				return;
			}

			if (!entries.length) return;

			const { maxVersion, touchedTypes } = await applyIncomingOps({
				db: this.db,
				codec: this.codec,
				ops: entries,
			});
			if (maxVersion !== undefined) await this.setCursor(maxVersion);
			if (touchedTypes.size) this.onEntitiesChanged(touchedTypes);

			if (next_cursor == null) return;
		}
	}

	// ---------- inbound delta handling ----------

	private async handleMessage(raw: unknown) {
		const bytes = await toWsFrameBytes(raw);
		if (!bytes) {
			console.warn("bad server frame type:", raw);
			return;
		}

		let frame: ServerFrame;
		try {
			frame = ServerFrame.decode(bytes);
		} catch (e) {
			console.warn("bad server frame:", e);
			return;
		}

		if (frame.ready) return;
		if (frame.error) {
			const message = frame.error.message || undefined;
			console.warn("server error:", frame.error.code, message);
			return;
		}
		if (!frame.delta) {
			console.warn("server frame missing body");
			return;
		}

		if (frame.delta.ackMaxVersion != null) {
			await this.setCursor(frame.delta.ackMaxVersion);
		}

		if (frame.delta.ops.length > 0) {
			const deltaOps: DeltaOp[] = frame.delta.ops.map((op) => ({
				id: op.id,
				_sync_hlc: op.syncHlc,
				_sync_is_deleted: op.syncIsDeleted,
				blob: op.blob,
				server_version: op.serverVersion,
			}));

			// Apply ops (idempotent).
			const { maxVersion, touchedTypes } = await applyIncomingOps({
				db: this.db,
				codec: this.codec,
				ops: deltaOps,
			});
			if (maxVersion !== undefined) await this.setCursor(maxVersion);
			if (touchedTypes.size) this.onEntitiesChanged(touchedTypes);
		}

		// If this is an ack for one of our pushes, clear the pending batch.
		const ackFor = frame.delta.ackFor || undefined;
		if (ackFor) {
			const pending = this.pendingBatches.get(ackFor);
			if (pending) {
				this.pendingBatches.delete(ackFor);
				// Mark all rows in the batch clean. If the server
				// rejected some as stale (equal/older HLC), those
				// are still effectively settled from our POV.
				await markDirtyEntriesSynced(this.db, pending);
			}
		}
	}

	// ---------- pushing dirty rows ----------

	private async pushDirtyLoop() {
		// Re-entrant guard: if already pushing, schedule another pass for when
		// the current one finishes so new mutations aren't missed.
		if (this.pushInFlight) {
			this.pushScheduledDuringInFlight = true;
			return;
		}
		this.pushInFlight = true;
		try {
			do {
				this.pushScheduledDuringInFlight = false;
				await this.pushOnePass();
			} while (this.pushScheduledDuringInFlight);
		} finally {
			this.pushInFlight = false;
		}
	}

	private async pushOnePass() {
		if (this.ws?.readyState !== WebSocket.OPEN) return;

		let cursor: string | undefined;
		while (this.running && this.ws?.readyState === WebSocket.OPEN) {
			const { entries, newCursor } = await getDirty({
				db: this.db,
				cursor,
			});
				if (!entries.length) return;

				const batchId = cryptoRandomId();
				const ops: WirePushOp[] = await Promise.all(
					entries.map(async (e) => ({
						id: e.id,
						syncHlc: e._sync_hlc,
						syncIsDeleted: !!e._sync_is_deleted,
						blob: await this.codec.encodeJsonBytes(e.plain_data),
					})),
				);

			this.pendingBatches.set(batchId, entries);
			this.ws.send(ClientFrame.encode({ push: { batchId, ops } }).finish());

			if (!newCursor) return;
			cursor = newCursor;
		}
	}
}

function cryptoRandomId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// -------------------- idb persistence --------------------

export type UiStorage = {
	id: string;
	dek: CryptoKey | null;
	cursor: number | null;
	sync_state: "enabled" | "paused" | null;
};

export const idb = new Dexie("money") as Dexie & {
	uiStorage: EntityTable<UiStorage, "id">;
};
idb.version(1).stores({
	uiStorage: "id, dek, cursor, sync_state",
});

export const uiStorageDefaults = {
	id: "1",
	dek: null,
	cursor: null,
	sync_state: null,
} satisfies UiStorage;

async function getUiStorage() {
	return await idb.uiStorage.where("id").equals(uiStorageDefaults.id).first();
}

async function persistCursor(newCursor: number) {
	const prev = await getUiStorage();
	// Monotonic: only advance, never regress (live delta vs. bootstrap race).
	if (prev?.cursor != null && prev.cursor >= newCursor) return;
	await idb.uiStorage.put({
		...(prev ?? uiStorageDefaults),
		cursor: newCursor,
	});
}

/** Unconditional set — used only for the server-was-reset recovery path. */
async function resetCursor(newCursor: number) {
	const prev = await getUiStorage();
	await idb.uiStorage.put({
		...(prev ?? uiStorageDefaults),
		cursor: newCursor,
	});
}

async function readCursor(): Promise<number | null> {
	const prev = await getUiStorage();
	return prev?.cursor ?? null;
}

async function markAllRowsPendingPush(db: DbHandle) {
	await Promise.all([
		db.exec(`update categories set _sync_status = 1`),
		db.exec(`update accounts set _sync_status = 1`),
		db.exec(`update transactions set _sync_status = 1`),
		db.exec(`update transaction_links set _sync_status = 1`),
	]);
}

// -------------------- React hook --------------------

export function useSync() {
	const uiStorage = useLiveQuery(getUiStorage);
	const canSync =
		uiStorage?.sync_state === "enabled" && !!uiStorage?.dek;
	const me = useMe();
	const db = useDb();
	const qc = useQueryClient();

	const clientRef = useRef<SyncClient | null>(null);
	// Keep the dek on a ref so its (unstable) reference doesn't retrigger
	// the lifecycle effect. Each read of uiStorage from dexie hands back a
	// fresh CryptoKey reference even though the underlying key is the same.
	const dekRef = useRef<CryptoKey | null>(uiStorage?.dek ?? null);
	dekRef.current = uiStorage?.dek ?? null;

	const onEntitiesChanged = useCallback(
		(types: Set<string>) => {
			if (types.has("account"))
				qc.invalidateQueries({ queryKey: queryKeyRoots.accounts });
			if (types.has("category"))
				qc.invalidateQueries({ queryKey: queryKeyRoots.categories });
			if (types.has("transaction")) {
				qc.invalidateQueries({ queryKey: queryKeyRoots.transactions });
				qc.invalidateQueries({ queryKey: queryKeyRoots.transaction });
			}
		},
		[qc],
	);
	const onEntitiesChangedRef = useRef(onEntitiesChanged);
	onEntitiesChangedRef.current = onEntitiesChanged;

	const enabled = canSync && !!me.data?.salt;

	// Lifecycle: spawn the client when enabled, stop when not.
	// We intentionally key the effect on `enabled` only — not on the dek
	// reference — so live-query ticks don't churn the connection.
	useEffect(() => {
		if (!enabled) {
			clientRef.current?.stop();
			clientRef.current = null;
			return;
		}

		const dek = dekRef.current;
		if (!dek) return;

		if (clientRef.current) return;

		const client = new SyncClient(
			db,
			dek,
			readCursor,
			persistCursor,
			resetCursor,
			(types) => onEntitiesChangedRef.current(types),
		);
		clientRef.current = client;
		client.start();

		return () => {
			client.stop();
			if (clientRef.current === client) clientRef.current = null;
		};
	}, [enabled, db]);

	// Drive push whenever the mutation cache invalidates our sync key.
	useQuery({
		enabled,
		queryKey: queryKeys.syncPush(enabled),
		queryFn: async () => {
			clientRef.current?.requestPush();
			return true;
		},
	});

	return null;
}
