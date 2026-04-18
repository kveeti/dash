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

// -------------------- types --------------------

type DirtyEntry = {
	id: string;
	_sync_is_deleted: number;
	_sync_edited_at: number;
	plain_data: string;
};

type DeltaOp = {
	id: string;
	_sync_is_deleted: boolean;
	_sync_edited_at: number;
	blob: string;
	server_version: number;
};

type PushOp = {
	id: string;
	_sync_is_deleted: boolean;
	_sync_edited_at: number;
	blob: string;
};

type DeltaEvent = {
	ops: DeltaOp[];
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

// -------------------- constants --------------------

const DIRTY_BATCH_LIMIT = 1000;
const BOOTSTRAP_PAGE_LIMIT = 1000;

// -------------------- dirty row helpers --------------------

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
	const byTable: Record<SyncTableName, string[]> = {
		categories: [],
		accounts: [],
		transactions: [],
		transaction_links: [],
	};

	for (const record of dirty) {
		const { tableName, actualId } = resolveTargetTable(record.id);
		byTable[tableName].push(actualId);
	}

	for (const [tableName, ids] of Object.entries(byTable) as Array<
		[SyncTableName, string[]]
	>) {
		if (ids.length === 0) continue;

		const placeholders = ids.map(() => "?").join(",");

		if (tableName === "transaction_links") {
			await db.exec(
				`update transaction_links
				set _sync_status = 0
				where transaction_a_id || '_' || transaction_b_id IN (${placeholders})`,
				ids,
			);
		} else {
			await db.exec(
				`update ${tableName}
				set _sync_status = 0
				where id in (${placeholders})`,
				ids,
			);
		}
	}
}

async function getDirty(db: DbHandle): Promise<DirtyEntry[]> {
	return db.query<DirtyEntry>(
		`
		select * from (
			select
				'category:' || id as id,
				_sync_is_deleted,
				_sync_edited_at,
				json_object('created_at', created_at, 'updated_at', updated_at, 'name', name, 'is_neutral', is_neutral) as plain_data,
				1 as priority
			from categories where _sync_status = 1

			union all

			select
				'account:' || id as id,
				_sync_is_deleted,
				_sync_edited_at,
				json_object('created_at', created_at, 'updated_at', updated_at, 'name', name) as plain_data,
				1 as priority
			from accounts where _sync_status = 1

			union all

			select
				'transaction:' || id as id,
				_sync_is_deleted,
				_sync_edited_at,
				json_object('created_at', created_at, 'updated_at', updated_at, 'date', date, 'amount', amount, 'currency', currency, 'counter_party', counter_party, 'additional', additional, 'notes', notes, 'categorize_on', categorize_on, 'category_id', category_id, 'account_id', account_id) as plain_data,
				2 as priority
			from transactions where _sync_status = 1

			union all

			select
				'transaction_link:' || transaction_a_id || '_' || transaction_b_id as id,
				_sync_is_deleted,
				_sync_edited_at,
				json_object('transaction_a_id', transaction_a_id, 'transaction_b_id', transaction_b_id, 'created_at', created_at) as plain_data,
				3 as priority
			from transaction_links where _sync_status = 1
		)
		-- Preserve dependency order across entity types so referenced rows
		-- (e.g. categories/accounts) land before transactions and links.
		order by priority asc
		limit ?;
	`,
		[DIRTY_BATCH_LIMIT],
	);
}

// -------------------- applying incoming deltas --------------------

/**
 * Upsert incoming deltas into SQLite.
 * Only overwrites a row if the incoming _sync_edited_at >= local _sync_edited_at,
 * so the last user edit wins regardless of push ordering.
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

	const transactionLinks: any[] = [];
	const transactionLinksValues: string[] = [];

	let maxVersion: number | undefined;
	const touchedTypes = new Set<string>();

	const decodedOps = await Promise.all(
		ops.map(async (op) => {
			const entry = await codec.decode(op.blob);
			if (!entry) return null;
			return { op, entry };
		}),
	);

	for (const item of decodedOps) {
		if (!item) continue;
		const { op, entry } = item;

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
					/* _sync_edited_at */ op._sync_edited_at,
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
					/* _sync_edited_at */ op._sync_edited_at,
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
					/* _sync_edited_at */ op._sync_edited_at,
				);
				transactionsValues.push(
					"(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
				);
				break;

			case "transaction_link": {
				touchedTypes.add("transaction");
				const [transactionAId, transactionBId] = id.split("_");
				if (!transactionAId || !transactionBId) break;
				transactionLinks.push(
					/* transaction_a_id */ transactionAId,
					/* transaction_b_id */ transactionBId,
					/* created_at */ entry.created_at,
					/* updated_at */ entry.updated_at ?? null,
					/* _sync_is_deleted */ op._sync_is_deleted ? 1 : 0,
					/* _sync_edited_at */ op._sync_edited_at,
				);
				transactionLinksValues.push("(?, ?, ?, ?, ?, ?, 0)");
				break;
			}
		}
	}

	// Upsert each table. Skip rows that are locally dirty — those will be
	// pushed to the server and the server's version will arrive later.
	if (accounts.length) {
		await db.exec(
			`insert into accounts (
				id, created_at, updated_at, name,
				_sync_is_deleted, _sync_edited_at, _sync_status
			)
			values ${accountsValues.join(",")}
			on conflict(id) do update set
				created_at = excluded.created_at,
				updated_at = excluded.updated_at,
				_sync_is_deleted = excluded._sync_is_deleted,
				_sync_edited_at = excluded._sync_edited_at,
				_sync_status = 0,
				name = excluded.name
			where excluded._sync_edited_at >= accounts._sync_edited_at;`,
			accounts,
		);
	}

	if (categories.length) {
		await db.exec(
			`insert into categories (
				id, created_at, updated_at, name, is_neutral,
				_sync_is_deleted, _sync_edited_at, _sync_status
			)
			values ${categoriesValues.join(",")}
			on conflict(id) do update set
				created_at = excluded.created_at,
				updated_at = excluded.updated_at,
				_sync_is_deleted = excluded._sync_is_deleted,
				_sync_edited_at = excluded._sync_edited_at,
				_sync_status = 0,
				name = excluded.name,
				is_neutral = excluded.is_neutral
			where excluded._sync_edited_at >= categories._sync_edited_at;`,
			categories,
		);
	}

	if (transactions.length) {
		await db.exec(
			`insert into transactions (
				id, created_at, updated_at, date, amount, currency,
				counter_party, additional, notes, categorize_on,
				category_id, account_id,
				_sync_is_deleted, _sync_edited_at, _sync_status
			)
			values ${transactionsValues.join(",")}
			on conflict(id) do update set
				created_at = excluded.created_at,
				updated_at = excluded.updated_at,
				_sync_is_deleted = excluded._sync_is_deleted,
				_sync_edited_at = excluded._sync_edited_at,
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
			where excluded._sync_edited_at >= transactions._sync_edited_at;`,
			transactions,
		);
	}

	if (transactionLinks.length) {
		await db.exec(
			`insert into transaction_links (
				transaction_a_id, transaction_b_id, created_at, updated_at,
				_sync_is_deleted, _sync_edited_at, _sync_status
			)
			values ${transactionLinksValues.join(",")}
			on conflict(transaction_a_id, transaction_b_id) do update set
				_sync_is_deleted = excluded._sync_is_deleted,
				_sync_edited_at = excluded._sync_edited_at,
				_sync_status = 0,
				created_at = excluded.created_at,
				updated_at = excluded.updated_at
			where excluded._sync_edited_at >= transaction_links._sync_edited_at;`,
			transactionLinks,
		);
	}

	return { maxVersion, touchedTypes };
}

// -------------------- SyncClient --------------------

class SyncClient {
	private events: EventSource | null = null;
	private running = false;
	private bootstrapInFlight = false;
	private pushInFlight = false;
	private pushScheduledDuringInFlight = false;
	private codec: SyncPayloadCodec;
	/** Deltas that arrived while bootstrap was running, replayed after it finishes. */
	private deltaQueue: DeltaEvent[] | null = null;

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
		const events = this.events;
		this.events = null;
		if (events) events.close();
	}

	/** Called by the React layer on mutation — push any dirty rows. */
	requestPush() {
		void this.pushDirtyLoop().catch((e) => console.error("push loop failed:", e));
	}

	// ---------- connection ----------

	private connect() {
		if (!this.running) return;
		let events: EventSource;
		try {
			events = new EventSource("/api/v1/events", { withCredentials: true });
		} catch (e) {
			console.warn("sse construct failed:", e);
			window.setTimeout(() => this.connect(), 1000);
			return;
		}
		this.events = events;

		events.onopen = () => {
			this.runBootstrap().catch((e) =>
				console.error("bootstrap failed:", e),
			);
			this.pushDirtyLoop().catch((e) =>
				console.error("push-on-open failed:", e),
			);
		};

		events.addEventListener("delta", (e) => {
			const msg = e as MessageEvent<unknown>;
			this.handleDeltaEvent(msg.data).catch((err) =>
				console.error("handle msg:", err),
			);
		});

		events.onerror = () => {
			// Browser EventSource reconnects automatically.
		};
	}

	// ---------- bootstrap ----------

	private async runBootstrap() {
		if (this.bootstrapInFlight) return;
		this.bootstrapInFlight = true;
		// Queue live deltas while bootstrap is running so they don't race with
		// cursor advancement. They'll be replayed once bootstrap finishes.
		this.deltaQueue = [];

		const touchedAcrossBootstrap = new Set<string>();
		let succeeded = false;
		try {
			let cursor = await this.getCursor();
			while (this.running) {
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
					succeeded = true;
					return;
				}

				if (!entries.length) {
					succeeded = true;
					return;
				}

				const { maxVersion, touchedTypes } = await applyIncomingOps({
					db: this.db,
					codec: this.codec,
					ops: entries,
				});
				if (maxVersion !== undefined) await this.setCursor(maxVersion);
				for (const type of touchedTypes) touchedAcrossBootstrap.add(type);

				if (next_cursor == null) {
					succeeded = true;
					return;
				}
				cursor = next_cursor;
			}
			succeeded = true;
		} finally {
			this.bootstrapInFlight = false;

			// Drain queued deltas that arrived during bootstrap.
			const queued = this.deltaQueue;
			this.deltaQueue = null;
			if (queued) {
				for (const msg of queued) {
					const { maxVersion, touchedTypes } = await applyIncomingOps({
						db: this.db,
						codec: this.codec,
						ops: msg.ops,
					});
					if (maxVersion !== undefined) await this.setCursor(maxVersion);
					for (const type of touchedTypes)
						touchedAcrossBootstrap.add(type);
				}
			}

			if (succeeded && touchedAcrossBootstrap.size) {
				this.onEntitiesChanged(touchedAcrossBootstrap);
			}
		}
	}

	// ---------- inbound delta handling ----------

	private async handleDeltaEvent(raw: unknown) {
		if (typeof raw !== "string") {
			console.warn("bad delta frame type:", raw);
			return;
		}

		let msg: DeltaEvent;
		try {
			msg = JSON.parse(raw);
		} catch (e) {
			console.warn("bad delta frame:", e);
			return;
		}
		if (!msg.ops.length) return;

		// If bootstrap is running, queue the delta to avoid cursor races.
		if (this.deltaQueue) {
			this.deltaQueue.push(msg);
			return;
		}

		// Apply ops (idempotent).
		const { maxVersion, touchedTypes } = await applyIncomingOps({
			db: this.db,
			codec: this.codec,
			ops: msg.ops,
		});
		if (maxVersion !== undefined) await this.setCursor(maxVersion);
		if (touchedTypes.size) this.onEntitiesChanged(touchedTypes);
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
		while (this.running) {
			const entries = await getDirty(this.db);
			if (!entries.length) return;

			const ops: PushOp[] = await Promise.all(
				entries.map(async (e) => ({
					id: e.id,
					_sync_is_deleted: !!e._sync_is_deleted,
					_sync_edited_at: e._sync_edited_at,
					blob: await this.codec.encodeJsonString(e.plain_data),
				})),
			);

			const res = await fetch("/api/v1/push", {
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ops }),
			});
			if (!res.ok) {
				throw new Error(`push ${res.status}`);
			}
			const ack = (await res.json()) as {
				ack_max_version?: number;
				not_applied_ids?: string[];
			};
			if (ack.ack_max_version != null) {
				await this.setCursor(ack.ack_max_version);
			}

			const notApplied = new Set(ack.not_applied_ids ?? []);
			const appliedEntries = entries.filter((entry) => !notApplied.has(entry.id));
			if (!appliedEntries.length) {
				// No forward progress for this batch; avoid tight retry loops on stale rows.
				return;
			}
			await markDirtyEntriesSynced(this.db, appliedEntries);
		}
	}
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
			if (types.has("transaction") || types.has("transaction_link")) {
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
