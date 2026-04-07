/**
 * Sync engine: pull → merge → push with HLC-based LWW conflict resolution.
 */

import type { DbHandle } from "./db";
import { encryptPayload, decryptPayload } from "./crypto";
import { compareHlc, makeHlc } from "./hlc";
import { getMaxHlc } from "./queries/transactions";
import {
	SCHEMA_VERSION,
	SYNCABLE_TABLES,
	type SyncableTable,
	type SyncPayload,
	getDirtyItems,
	itemId,
	parseItemId,
	rowToPayload,
	upsertFromSync,
	cascadeTombstone,
	clearDirtyFlag,
} from "./sync-payload";
import { CURRENT_SCHEMA_VERSION, migratePayload } from "./sync-schema";

const LS_LAST_SYNC_VERSION = "dash_last_sync_version";
const MAX_CLOCK_DRIFT_MS = 60_000;
const MAX_PUSH_RETRIES = 3;

export type SyncResult = {
	pulled: number;
	pushed: number;
	rejected: number;
	forceReset: boolean;
	error?: string;
};

type PullItem = {
	item_id: string;
	schema_version: number;
	hlc: string;
	server_version: number;
	encrypted_blob: string;
	is_deleted: boolean;
};

type PullResponse = {
	items: PullItem[];
	has_more: boolean;
	force_reset?: boolean;
};

type PushResponseItem = { item_id: string; current_hlc: string };

type PushResponse = {
	accepted: string[];
	rejected: PushResponseItem[];
};

function getLastSyncVersion(): number {
	return parseInt(localStorage.getItem(LS_LAST_SYNC_VERSION) ?? "0", 10);
}

function setLastSyncVersion(v: number) {
	localStorage.setItem(LS_LAST_SYNC_VERSION, String(v));
}

export function clearSyncState() {
	localStorage.removeItem(LS_LAST_SYNC_VERSION);
}

async function apiFetch(
	url: string,
	token: string,
	init?: RequestInit,
): Promise<Response> {
	const res = await fetch(url, {
		...init,
		headers: {
			...(init?.headers ?? {}),
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
	});
	if (res.status === 401) {
		throw new Error("Unauthorized — token expired or invalid");
	}
	return res;
}

// --- Clock drift check ---

async function checkClockDrift(serverUrl: string, token: string): Promise<void> {
	const res = await apiFetch(`${serverUrl}/sync/handshake`, token);
	if (!res.ok) throw new Error("Handshake failed");
	const { server_time_ms }: { server_time_ms: number } = await res.json();
	const drift = Math.abs(Date.now() - server_time_ms);
	if (drift > MAX_CLOCK_DRIFT_MS) {
		throw new Error(
			`Clock drift too large (${Math.round(drift / 1000)}s). Sync aborted — fix your system clock.`,
		);
	}
}

// --- Pull ---

async function pull(
	db: DbHandle,
	dek: CryptoKey,
	serverUrl: string,
	token: string,
): Promise<{ pulled: number; forceReset: boolean }> {
	let sinceVersion = getLastSyncVersion();
	let totalPulled = 0;

	while (true) {
		const res = await apiFetch(
			`${serverUrl}/sync/pull?since_version=${sinceVersion}&limit=1000`,
			token,
		);
		if (!res.ok) throw new Error(`Pull failed: ${res.status}`);

		const data: PullResponse = await res.json();

		if (data.force_reset) {
			// Server says our version is too old — need full reset
			setLastSyncVersion(0);
			return { pulled: 0, forceReset: true };
		}

		for (const item of data.items) {
			await mergeIncoming(db, dek, item);
			// Track highest server_version we've seen
			if (item.server_version > sinceVersion) {
				sinceVersion = item.server_version;
			}
		}

		totalPulled += data.items.length;
		setLastSyncVersion(sinceVersion);

		if (!data.has_more) break;
	}

	return { pulled: totalPulled, forceReset: false };
}

async function mergeIncoming(
	db: DbHandle,
	dek: CryptoKey,
	item: PullItem,
): Promise<void> {
	const { table, keys } = parseItemId(item.item_id);

	// Decrypt payload
	const json = await decryptPayload(item.encrypted_blob, dek);
	let payload: SyncPayload = JSON.parse(json);

	// Schema migration: upgrade old payloads to current version
	let needsRepush = false;
	if (item.schema_version < CURRENT_SCHEMA_VERSION) {
		const migrated = migratePayload(payload, item.schema_version);
		if (migrated) {
			payload = migrated;
			needsRepush = true;
		}
	}

	// Get local HLC for this item
	const localHlc = await getLocalHlc(db, table, keys);

	// LWW: highest HLC wins
	if (localHlc && compareHlc(localHlc, item.hlc) >= 0) {
		// Local wins — skip, our version will be pushed
		return;
	}

	// Incoming wins — upsert
	await upsertFromSync(db, table, payload.data, item.hlc, item.is_deleted);

	// If schema was migrated, mark dirty so it gets re-pushed with new version
	if (needsRepush) {
		if (table === "transaction_links") {
			await db.exec(
				`update transaction_links set is_dirty = 1
				 where transaction_a_id = ? and transaction_b_id = ?`,
				[keys.transaction_a_id, keys.transaction_b_id],
			);
		} else {
			await db.exec(
				`update ${table} set is_dirty = 1 where id = ?`,
				[keys.id],
			);
		}
	}

	// Cascade tombstones if needed
	if (item.is_deleted) {
		await cascadeTombstone(db, table, payload.data);
	}
}

async function getLocalHlc(
	db: DbHandle,
	table: SyncableTable,
	keys: Record<string, string>,
): Promise<string | null> {
	let rows: { hlc: string | null }[];
	if (table === "transaction_links") {
		rows = await db.query<{ hlc: string | null }>(
			`select hlc from transaction_links
			 where transaction_a_id = ? and transaction_b_id = ?`,
			[keys.transaction_a_id, keys.transaction_b_id],
		);
	} else {
		rows = await db.query<{ hlc: string | null }>(
			`select hlc from ${table} where id = ?`,
			[keys.id],
		);
	}
	return rows[0]?.hlc ?? null;
}

// --- Push ---

async function push(
	db: DbHandle,
	dek: CryptoKey,
	serverUrl: string,
	token: string,
): Promise<{ pushed: number; rejected: number }> {
	// Collect all dirty items across all tables
	const pushItems: {
		item_id: string;
		table: SyncableTable;
		keys: Record<string, string>;
		schema_version: number;
		hlc: string;
		encrypted_blob: string;
		is_deleted: boolean;
	}[] = [];

	for (const table of SYNCABLE_TABLES) {
		const dirtyRows = await getDirtyItems(db, table);
		for (const row of dirtyRows) {
			const id = itemId(table, row);
			const payload = rowToPayload(table, row);
			const encrypted = await encryptPayload(JSON.stringify(payload), dek);

			pushItems.push({
				item_id: id,
				table,
				keys: parseItemId(id).keys,
				schema_version: SCHEMA_VERSION,
				hlc: row.hlc,
				encrypted_blob: encrypted,
				is_deleted: !!row.is_deleted,
			});
		}
	}

	if (pushItems.length === 0) return { pushed: 0, rejected: 0 };

	// Push in batches of 100
	let totalPushed = 0;
	let totalRejected = 0;
	const BATCH = 100;

	for (let i = 0; i < pushItems.length; i += BATCH) {
		const batch = pushItems.slice(i, i + BATCH);
		const result = await pushBatch(db, dek, batch, serverUrl, token, 0);
		totalPushed += result.pushed;
		totalRejected += result.rejected;
	}

	return { pushed: totalPushed, rejected: totalRejected };
}

async function pushBatch(
	db: DbHandle,
	dek: CryptoKey,
	items: {
		item_id: string;
		table: SyncableTable;
		keys: Record<string, string>;
		schema_version: number;
		hlc: string;
		encrypted_blob: string;
		is_deleted: boolean;
	}[],
	serverUrl: string,
	token: string,
	attempt: number,
): Promise<{ pushed: number; rejected: number }> {
	const res = await apiFetch(`${serverUrl}/sync/push`, token, {
		method: "POST",
		body: JSON.stringify({
			items: items.map((i) => ({
				item_id: i.item_id,
				schema_version: i.schema_version,
				hlc: i.hlc,
				encrypted_blob: i.encrypted_blob,
				is_deleted: i.is_deleted,
			})),
		}),
	});

	if (!res.ok) throw new Error(`Push failed: ${res.status}`);
	const data: PushResponse = await res.json();

	// Clear dirty flags for accepted items
	for (const acceptedId of data.accepted) {
		const { table, keys } = parseItemId(acceptedId);
		await clearDirtyFlag(db, table, keys);
	}

	if (data.rejected.length === 0) {
		return { pushed: data.accepted.length, rejected: 0 };
	}

	if (attempt >= MAX_PUSH_RETRIES) {
		// Give up on these items — they'll be retried next sync
		return { pushed: data.accepted.length, rejected: data.rejected.length };
	}

	// For rejected items: pull that specific item's latest, merge, bump HLC, retry
	const retryItems: typeof items = [];

	for (const rejected of data.rejected) {
		const original = items.find((i) => i.item_id === rejected.item_id);
		if (!original) continue;

		// Pull the latest version of this item
		const pullRes = await apiFetch(
			`${serverUrl}/sync/pull?since_version=0&limit=1`,
			token,
		);
		// For now, just bump our HLC past the server's and retry
		const newHlc = makeHlc(Date.now(), await getMaxHlc(db));

		// Update local row's HLC
		if (original.table === "transaction_links") {
			await db.exec(
				`update transaction_links set hlc = ?, is_dirty = 1
				 where transaction_a_id = ? and transaction_b_id = ?`,
				[newHlc, original.keys.transaction_a_id, original.keys.transaction_b_id],
			);
		} else {
			await db.exec(
				`update ${original.table} set hlc = ?, is_dirty = 1 where id = ?`,
				[newHlc, original.keys.id],
			);
		}

		// Re-encrypt with new HLC
		const dirtyRow = await getLocalRow(db, original.table, original.keys);
		if (!dirtyRow) continue;

		const payload = rowToPayload(original.table, dirtyRow);
		const encrypted = await encryptPayload(JSON.stringify(payload), dek);

		retryItems.push({
			...original,
			hlc: newHlc,
			encrypted_blob: encrypted,
		});
	}

	if (retryItems.length > 0) {
		const retryResult = await pushBatch(db, dek, retryItems, serverUrl, token, attempt + 1);
		return {
			pushed: data.accepted.length + retryResult.pushed,
			rejected: retryResult.rejected,
		};
	}

	return { pushed: data.accepted.length, rejected: data.rejected.length };
}

async function getLocalRow(
	db: DbHandle,
	table: SyncableTable,
	keys: Record<string, string>,
): Promise<Record<string, any> | null> {
	let rows: Record<string, any>[];
	if (table === "transaction_links") {
		rows = await db.query(
			`select * from transaction_links
			 where transaction_a_id = ? and transaction_b_id = ?`,
			[keys.transaction_a_id, keys.transaction_b_id],
		);
	} else {
		rows = await db.query(
			`select * from ${table} where id = ?`,
			[keys.id],
		);
	}
	return rows[0] ?? null;
}

// --- Main entry point ---

export async function runSync(
	db: DbHandle,
	dek: CryptoKey,
	serverUrl: string,
	token: string,
): Promise<SyncResult> {
	try {
		// 1. Clock drift check
		await checkClockDrift(serverUrl, token);

		// 2. Pull
		const pullResult = await pull(db, dek, serverUrl, token);

		if (pullResult.forceReset) {
			return {
				pulled: 0,
				pushed: 0,
				rejected: 0,
				forceReset: true,
				error: "Server requested full reset — data was compacted",
			};
		}

		// 3. Push
		const pushResult = await push(db, dek, serverUrl, token);

		return {
			pulled: pullResult.pulled,
			pushed: pushResult.pushed,
			rejected: pushResult.rejected,
			forceReset: false,
		};
	} catch (e: any) {
		return {
			pulled: 0,
			pushed: 0,
			rejected: 0,
			forceReset: false,
			error: e.message ?? String(e),
		};
	}
}
