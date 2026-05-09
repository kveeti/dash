import { useLiveQuery } from "dexie-react-hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	createDekSyncPayloadCodec,
	parseJsonObjectBlob,
	type SyncPayloadCodec,
	type SyncPayloadMetadata,
} from "./crypto";
import { useEncrypted } from "../encrypted-context";
import type { DbHandle } from "./db/client";
import { queryKeyRoots, queryKeys } from "./queries/query-keys";
import { normalizeCurrency } from "./currency";
import { loginWithAccountRootKey } from "./queries/auth";
import { getUiStorage, idb, uiStorageDefaults } from "./local-storage";
import { broadcastDbChange, type DbChangeRoot } from "./db-change-broadcast";
import {
	CURRENT_PAYLOAD_VERSION,
	decodeSyncRecord,
	parseSyncRecordId,
	validateDirtyPayload,
	type SyncTableName,
} from "./sync-schema";
import { refreshTransactionSearchDocs } from "./db/transactions";

type DirtyEntry = {
	id: string;
	_sync_is_deleted: number;
	_sync_edited_at: number;
	plain_data: string;
};

type DeltaOp = {
	id: string;
	pv: number;
	_sync_is_deleted: boolean;
	_sync_edited_at: number;
	blob: string;
	server_version: number;
};

type PushOp = {
	id: string;
	pv: number;
	_sync_is_deleted: boolean;
	_sync_edited_at: number;
	blob: string;
};

type SqlValue = string | number | null;

type DeltaEvent = {
	ops: DeltaOp[];
};

type BootstrapResponse = {
	entries: DeltaOp[];
	next_cursor?: number;
	server_max_version: number;
};

const DIRTY_BATCH_LIMIT = 1000;
const BOOTSTRAP_PAGE_LIMIT = 1000;

async function markDirtyEntriesSynced(db: DbHandle, dirty: DirtyEntry[]) {
	const byTable: Record<SyncTableName, string[]> = {
		categories: [],
		accounts: [],
		transactions: [],
		transaction_import_keys: [],
		transaction_flows: [],
	};

	for (const record of dirty) {
		const { tableName, actualId } = parseSyncRecordId(record.id);
		byTable[tableName].push(actualId);
	}

	for (const [tableName, ids] of Object.entries(byTable) as Array<
		[SyncTableName, string[]]
	>) {
		if (ids.length === 0) continue;

		const placeholders = ids.map(() => "?").join(",");

		await db.exec(
			`update ${tableName}
			set _sync_status = 0
			where id in (${placeholders})`,
			ids,
		);
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
				json_object('created_at', created_at, 'updated_at', updated_at, 'name', name, 'currency', currency, 'external_id', external_id) as plain_data,
				1 as priority
			from accounts where _sync_status = 1

			union all

			select
				'transaction:' || id as id,
				_sync_is_deleted,
				_sync_edited_at,
				json_object('created_at', created_at, 'updated_at', updated_at, 'date', date, 'amount_minor', amount_minor, 'currency', currency, 'counter_party', counter_party, 'additional', additional, 'notes', notes, 'categorize_on', categorize_on, 'category_id', category_id, 'account_id', account_id) as plain_data,
				2 as priority
			from transactions where _sync_status = 1

			union all

			select
				'transaction_import_key:' || id as id,
				_sync_is_deleted,
				_sync_edited_at,
				json_object('transaction_id', transaction_id, 'source_type', source_type, 'source_scope', source_scope, 'key_type', key_type, 'key_value', key_value, 'created_at', created_at, 'last_seen_at', last_seen_at, 'seen_count', seen_count) as plain_data,
				3 as priority
			from transaction_import_keys where _sync_status = 1

			union all

			select
				'transaction_flow:' || id as id,
				_sync_is_deleted,
				_sync_edited_at,
				json_object('from_transaction_id', from_transaction_id, 'to_transaction_id', to_transaction_id, 'amount_minor', amount_minor, 'currency', currency, 'to_amount_minor', to_amount_minor, 'to_currency', to_currency, 'kind', kind, 'created_at', created_at, 'updated_at', updated_at, 'notes', notes) as plain_data,
				4 as priority
			from transaction_flows where _sync_status = 1
		)
		-- Preserve dependency order across entity types so referenced rows
		-- (e.g. categories/accounts) land before transactions and links.
		order by priority asc
		limit ?;
	`,
		[DIRTY_BATCH_LIMIT],
	);
}

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

	const accounts: SqlValue[] = [];
	const accountsValues: string[] = [];

	const categories: SqlValue[] = [];
	const categoriesValues: string[] = [];

	const transactions: SqlValue[] = [];
	const transactionsValues: string[] = [];
	const transactionIds: string[] = [];

	const transactionImportKeys: SqlValue[] = [];
	const transactionImportKeysValues: string[] = [];

	const transactionFlows: SqlValue[] = [];
	const transactionFlowsValues: string[] = [];

	let maxVersion: number | undefined;
	const touchedTypes = new Set<string>();

	const decodedOps = await Promise.all(
		ops.map(async (op) => {
			const envelope = await codec.decode(op.blob, op);
			return { op, record: decodeSyncRecord(envelope) };
		}),
	);

	for (const item of decodedOps) {
		const { op, record } = item;

		if (maxVersion === undefined || op.server_version > maxVersion) {
			maxVersion = op.server_version;
		}

		touchedTypes.add(record.recordType);
		switch (record.recordType) {
			case "account": {
				const entry = record.data;
				accounts.push(
					/* id */ record.actualId,
					/* created_at */ entry.created_at,
					/* updated_at */ entry.updated_at,
					/* name */ entry.name,
					/* currency */ normalizeCurrency(entry.currency),
					/* external_id */ entry.external_id ?? null,
					/* _sync_is_deleted */ op._sync_is_deleted ? 1 : 0,
					/* _sync_edited_at */ op._sync_edited_at,
				);
				accountsValues.push("(?, ?, ?, ?, ?, ?, ?, ?, 0)");
				break;
			}

			case "category": {
				const entry = record.data;
				categories.push(
					/* id */ record.actualId,
					/* created_at */ entry.created_at,
					/* updated_at */ entry.updated_at,
					/* name */ entry.name,
					/* is_neutral */ entry.is_neutral,
					/* _sync_is_deleted */ op._sync_is_deleted ? 1 : 0,
					/* _sync_edited_at */ op._sync_edited_at,
				);
				categoriesValues.push("(?, ?, ?, ?, ?, ?, ?, 0)");
				break;
			}

			case "transaction": {
				const entry = record.data;
				transactionIds.push(record.actualId);
				transactions.push(
					/* id */ record.actualId,
					/* created_at */ entry.created_at,
					/* updated_at */ entry.updated_at,
					/* date */ entry.date,
					/* amount_minor */ entry.amount_minor,
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
			}

			case "transaction_import_key": {
				const entry = record.data;
				transactionImportKeys.push(
					/* id */ record.actualId,
					/* transaction_id */ entry.transaction_id,
					/* source_type */ entry.source_type,
					/* source_scope */ entry.source_scope,
					/* key_type */ entry.key_type,
					/* key_value */ entry.key_value,
					/* created_at */ entry.created_at,
					/* last_seen_at */ entry.last_seen_at,
					/* seen_count */ entry.seen_count,
					/* _sync_is_deleted */ op._sync_is_deleted ? 1 : 0,
					/* _sync_edited_at */ op._sync_edited_at,
				);
				transactionImportKeysValues.push(
					"(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
				);
				break;
			}

			case "transaction_flow": {
				touchedTypes.add("transaction");
				const entry = record.data;
				transactionFlows.push(
					/* id */ record.actualId,
					/* from_transaction_id */ entry.from_transaction_id,
					/* to_transaction_id */ entry.to_transaction_id,
					/* amount_minor */ entry.amount_minor,
					/* currency */ normalizeCurrency(entry.currency),
					/* to_amount_minor */ entry.to_amount_minor ?? null,
					/* to_currency */ entry.to_currency
						? normalizeCurrency(entry.to_currency)
						: null,
					/* kind */ entry.kind,
					/* created_at */ entry.created_at,
					/* updated_at */ entry.updated_at ?? null,
					/* notes */ entry.notes ?? null,
					/* _sync_is_deleted */ op._sync_is_deleted ? 1 : 0,
					/* _sync_edited_at */ op._sync_edited_at,
				);
				transactionFlowsValues.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)");
				break;
			}
		}
	}

	// Upsert each table. Skip rows that are locally dirty — those will be
	// pushed to the server and the server's version will arrive later.
	if (accounts.length) {
		await db.exec(
			`insert into accounts (
				id, created_at, updated_at, name, currency, external_id,
				_sync_is_deleted, _sync_edited_at, _sync_status
			)
			values ${accountsValues.join(",")}
			on conflict(id) do update set
				created_at = excluded.created_at,
				updated_at = excluded.updated_at,
				_sync_is_deleted = excluded._sync_is_deleted,
				_sync_edited_at = excluded._sync_edited_at,
				_sync_status = 0,
				name = excluded.name,
				currency = excluded.currency,
				external_id = excluded.external_id
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
				id, created_at, updated_at, date, amount_minor, currency,
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
				amount_minor = excluded.amount_minor,
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
		await refreshTransactionSearchDocs(db, transactionIds);
	}

	if (transactionImportKeys.length) {
		await db.exec(
			`insert into transaction_import_keys (
				id, transaction_id, source_type, source_scope, key_type, key_value,
				created_at, last_seen_at, seen_count,
				_sync_is_deleted, _sync_edited_at, _sync_status
			)
			values ${transactionImportKeysValues.join(",")}
			on conflict(source_type, source_scope, key_type, key_value)
			where _sync_is_deleted = 0
			do update set
				transaction_id = excluded.transaction_id,
				created_at = excluded.created_at,
				last_seen_at = excluded.last_seen_at,
				seen_count = excluded.seen_count,
				_sync_is_deleted = excluded._sync_is_deleted,
				_sync_edited_at = excluded._sync_edited_at,
				_sync_status = 0
			where excluded._sync_edited_at >= transaction_import_keys._sync_edited_at;`,
			transactionImportKeys,
		);
	}

	if (transactionFlows.length) {
		await db.exec(
			`insert into transaction_flows (
				id, from_transaction_id, to_transaction_id, amount_minor, currency,
				to_amount_minor, to_currency, kind,
				created_at, updated_at, notes,
				_sync_is_deleted, _sync_edited_at, _sync_status
			)
			values ${transactionFlowsValues.join(",")}
			on conflict(id) do update set
				_sync_is_deleted = excluded._sync_is_deleted,
				_sync_edited_at = excluded._sync_edited_at,
				_sync_status = 0,
				from_transaction_id = excluded.from_transaction_id,
				to_transaction_id = excluded.to_transaction_id,
				amount_minor = excluded.amount_minor,
				currency = excluded.currency,
				to_amount_minor = excluded.to_amount_minor,
				to_currency = excluded.to_currency,
				kind = excluded.kind,
				created_at = excluded.created_at,
				updated_at = excluded.updated_at,
				notes = excluded.notes
			where excluded._sync_edited_at >= transaction_flows._sync_edited_at;`,
			transactionFlows,
		);
	}

	return { maxVersion, touchedTypes };
}

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
			if (succeeded && queued) {
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
				entries.map(async (e) => {
					const metadata: SyncPayloadMetadata = {
						id: e.id,
						pv: CURRENT_PAYLOAD_VERSION,
						_sync_is_deleted: !!e._sync_is_deleted,
						_sync_edited_at: e._sync_edited_at,
					};
					const data = parseJsonObjectBlob(e.plain_data);
					if (!data) {
						throw new Error(`invalid dirty sync payload: ${e.id}`);
					}
					validateDirtyPayload({ id: e.id, pv: metadata.pv, d: data });
					return {
						id: e.id,
						pv: metadata.pv,
						_sync_is_deleted: metadata._sync_is_deleted,
						_sync_edited_at: metadata._sync_edited_at,
						blob: await this.codec.encodeJsonString(e.plain_data, metadata),
					};
				}),
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

async function persistCursor(newCursor: number) {
	const prev = await getUiStorage();
	// Monotonic: only advance, never regress (live delta vs. bootstrap race).
	if (prev?.cursor != null && prev.cursor >= newCursor) return;
	await idb.uiStorage.put({
		...(prev ?? uiStorageDefaults),
		cursor: newCursor,
	});
}

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
		db.exec(`update transaction_import_keys set _sync_status = 1`),
		db.exec(`update transaction_flows set _sync_status = 1`),
	]);
}

// -------------------- React hook --------------------

export function useSync() {
	const uiStorage = useLiveQuery(getUiStorage);
	const canSync = uiStorage?.sync_state === "enabled";
	const isOnline = useOnlineStatus();
	const { db, accountRootKey, syncContentKey } = useEncrypted();
	const qc = useQueryClient();

	const clientRef = useRef<SyncClient | null>(null);

	const onEntitiesChanged = useCallback(
		(types: Set<string>) => {
			const changedRoots: DbChangeRoot[] = [];
			if (types.has("account")) {
				qc.invalidateQueries({ queryKey: queryKeyRoots.accounts });
				changedRoots.push("accounts");
			}
			if (types.has("category")) {
				qc.invalidateQueries({ queryKey: queryKeyRoots.categories });
				changedRoots.push("categories");
			}
			if (types.has("transaction") || types.has("transaction_flow")) {
				qc.invalidateQueries({ queryKey: queryKeyRoots.transactions });
				qc.invalidateQueries({ queryKey: queryKeyRoots.transaction });
				qc.invalidateQueries({ queryKey: queryKeyRoots.transactionFlows });
				qc.invalidateQueries({ queryKey: queryKeyRoots.transactionLinkSuggestions });
				qc.invalidateQueries({ queryKey: queryKeyRoots.stats });
				changedRoots.push(
					"transactions",
					"transaction",
					"transactionFlows",
					"transactionLinkSuggestions",
					"stats",
				);
			}
			broadcastDbChange(changedRoots);
		},
		[qc],
	);
	const onEntitiesChangedRef = useRef(onEntitiesChanged);
	useEffect(() => {
		onEntitiesChangedRef.current = onEntitiesChanged;
	}, [onEntitiesChanged]);

	const enabled = canSync && isOnline;

	useEffect(() => {
		let cancelled = false;

		if (!enabled) {
			clientRef.current?.stop();
			clientRef.current = null;
			return;
		}

		if (clientRef.current) return;

		(async () => {
			try {
				await loginWithAccountRootKey(accountRootKey);

				if (cancelled) return;
				const client = new SyncClient(
					db,
					syncContentKey,
					readCursor,
					persistCursor,
					resetCursor,
					(types) => onEntitiesChangedRef.current(types),
				);
				clientRef.current = client;
				client.start();
			} catch (error) {
				console.error("sync auth failed:", error);
			}
		})();

		return () => {
			cancelled = true;
			clientRef.current?.stop();
			clientRef.current = null;
		};
	}, [enabled, db, accountRootKey, syncContentKey]);

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

function useOnlineStatus() {
	const [isOnline, setIsOnline] = useState(() =>
		typeof navigator === "undefined" ? true : navigator.onLine,
	);

	useEffect(() => {
		const updateOnlineStatus = () => setIsOnline(navigator.onLine);
		window.addEventListener("online", updateOnlineStatus);
		window.addEventListener("offline", updateOnlineStatus);
		updateOnlineStatus();
		return () => {
			window.removeEventListener("online", updateOnlineStatus);
			window.removeEventListener("offline", updateOnlineStatus);
		};
	}, []);

	return isOnline;
}
