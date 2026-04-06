import type { DbHandle } from "./db";

// Tables that participate in sync. Each must have: id, updated_at, deleted_at, local_seq
const SYNC_TABLES = ["categories", "accounts", "transactions", "transaction_links"] as const;

// Primary key columns per table (used for upsert conflict targets)
const TABLE_PKS: Record<string, string[]> = {
	categories: ["id"],
	accounts: ["id"],
	transactions: ["id"],
	transaction_links: ["transaction_a_id", "transaction_b_id"],
};

// --- Sync config (stored in localStorage — credentials, not data) ---

export type SyncConfig = {
	syncId: string;
	serverUrl: string;
	passphrase: string;
};

const SYNC_CONFIG_KEY = "dash_sync_config";

export function getSyncConfig(): SyncConfig | null {
	const raw = localStorage.getItem(SYNC_CONFIG_KEY);
	if (!raw) return null;
	return JSON.parse(raw);
}

export function saveSyncConfig(config: SyncConfig) {
	localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
}

export function clearSyncConfig() {
	localStorage.removeItem(SYNC_CONFIG_KEY);
}

// --- Sync counters (stored in db _sync table — atomic with row writes) ---

type SyncCounters = {
	seq: number;
	last_pushed_seq: number;
	cursor: number;
};

export async function getSyncCounters(db: DbHandle): Promise<SyncCounters> {
	const rows = await db.query<SyncCounters>("SELECT seq, last_pushed_seq, cursor FROM _sync LIMIT 1");
	return rows[0];
}

// Bump seq and return the new value. Always bumps regardless of whether sync
// is enabled — cheap, and means enabling sync later captures full history.
export async function nextSeq(db: DbHandle): Promise<number> {
	await db.exec("UPDATE _sync SET seq = seq + 1");
	const rows = await db.query<{ seq: number }>("SELECT seq FROM _sync LIMIT 1");
	window.dispatchEvent(new Event("dash-sync-dirty"));
	return rows[0].seq;
}

// Bump seq by N and return the new (highest) value. For batch inserts.
export async function nextSeqBatch(db: DbHandle, count: number): Promise<number> {
	await db.exec("UPDATE _sync SET seq = seq + ?", [count]);
	const rows = await db.query<{ seq: number }>("SELECT seq FROM _sync LIMIT 1");
	window.dispatchEvent(new Event("dash-sync-dirty"));
	return rows[0].seq;
}

// --- Encryption ---

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		enc.encode(passphrase),
		"PBKDF2",
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

async function encrypt(data: string, passphrase: string): Promise<Uint8Array> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKey(passphrase, salt);
	const enc = new TextEncoder();
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		enc.encode(data),
	);
	// Format: salt (16) + iv (12) + ciphertext
	const result = new Uint8Array(16 + 12 + ciphertext.byteLength);
	result.set(salt, 0);
	result.set(iv, 16);
	result.set(new Uint8Array(ciphertext), 28);
	return result;
}

async function decrypt(blob: Uint8Array, passphrase: string): Promise<string> {
	const salt = blob.slice(0, 16);
	const iv = blob.slice(16, 28);
	const ciphertext = blob.slice(28);
	const key = await deriveKey(passphrase, salt);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		ciphertext,
	);
	return new TextDecoder().decode(plaintext);
}

// --- Changeset format ---

type ChangesetPayload = {
	schemaVersion: number;
	upserts: Record<string, Record<string, unknown>[]>;
	deletes: { table: string; pks: Record<string, unknown>; deleted_at: string; updated_at: string }[];
};

// --- Core sync logic ---

async function collectDirtyRows(
	db: DbHandle,
	schemaVersion: number,
): Promise<ChangesetPayload> {
	const { last_pushed_seq } = await getSyncCounters(db);

	const payload: ChangesetPayload = {
		schemaVersion,
		upserts: {},
		deletes: [],
	};

	for (const table of SYNC_TABLES) {
		// Live rows that changed since last push
		const rows = await db.query(
			`SELECT * FROM ${table} WHERE local_seq > ? AND deleted_at IS NULL`,
			[last_pushed_seq],
		);
		if (rows.length > 0) {
			payload.upserts[table] = rows;
		}

		// Soft-deleted rows that changed since last push
		const deleted = await db.query(
			`SELECT * FROM ${table} WHERE local_seq > ? AND deleted_at IS NOT NULL`,
			[last_pushed_seq],
		);
		for (const row of deleted) {
			const pks: Record<string, unknown> = {};
			for (const col of TABLE_PKS[table]) {
				pks[col] = row[col];
			}
			payload.deletes.push({
				table,
				pks,
				deleted_at: row.deleted_at as string,
				updated_at: row.updated_at as string,
			});
		}
	}

	return payload;
}

function buildUpsertSql(table: string, columns: string[]): string {
	const pks = TABLE_PKS[table];
	const placeholders = columns.map(() => "?").join(", ");
	const colList = columns.join(", ");
	const updateCols = columns
		.filter((c) => !pks.includes(c))
		.map((c) => `${c} = excluded.${c}`)
		.join(", ");

	return `INSERT INTO ${table} (${colList}) VALUES (${placeholders})
		ON CONFLICT (${pks.join(", ")}) DO UPDATE SET ${updateCols}`;
}

async function applyIncoming(
	db: DbHandle,
	payload: ChangesetPayload,
	cursor: number,
): Promise<void> {
	await db.withTx(async () => {
		// Apply upserts — only if incoming updated_at > local updated_at
		for (const [table, rows] of Object.entries(payload.upserts)) {
			if (!rows.length) continue;
			const columns = Object.keys(rows[0]);
			const sql = buildUpsertSql(table, columns);

			for (const row of rows) {
				const pks = TABLE_PKS[table];
				const pkWhere = pks.map((pk) => `${pk} = ?`).join(" AND ");
				const pkValues = pks.map((pk) => row[pk]);

				const local = await db.query(
					`SELECT updated_at, deleted_at FROM ${table} WHERE ${pkWhere}`,
					pkValues,
				);

				if (local.length > 0) {
					// If local is deleted, incoming live row wins (resurrection)
					// If local is live, standard LWW comparison
					if (!local[0].deleted_at && local[0].updated_at >= (row.updated_at as string)) {
						continue; // local wins
					}
				}

				// Apply with local_seq = 0 so it doesn't get re-pushed
				const values = columns.map((c) => c === "local_seq" ? 0 : row[c]);
				await db.exec(sql, values);
			}
		}

		// Apply deletes — only if incoming delete is newer than local updated_at
		for (const del of payload.deletes) {
			const pks = TABLE_PKS[del.table];
			const pkWhere = pks.map((pk) => `${pk} = ?`).join(" AND ");
			const pkValues = pks.map((pk) => del.pks[pk]);

			await db.exec(
				`UPDATE ${del.table} SET deleted_at = ?, local_seq = 0
				 WHERE ${pkWhere} AND deleted_at IS NULL AND updated_at < ?`,
				[del.deleted_at, ...pkValues, del.updated_at],
			);
		}

		// Atomic cursor update
		await db.exec("UPDATE _sync SET cursor = ?", [cursor]);
	});
}

// --- Server communication ---

type ServerChangeset = {
	version: number;
	data: string; // base64
};

type ServerVersionInfo = {
	version: number;
	snapshot_version: number;
	snapshot_at: string | null;
};

async function serverPush(
	serverUrl: string,
	syncId: string,
	blob: Uint8Array,
): Promise<number> {
	const res = await fetch(`${serverUrl}/sync/${syncId}/push`, {
		method: "POST",
		body: blob,
	});
	if (!res.ok) throw new Error(`push failed: ${res.status}`);
	const json = await res.json();
	return json.version;
}

async function serverPull(
	serverUrl: string,
	syncId: string,
	after: number,
	limit = 100,
): Promise<ServerChangeset[]> {
	const res = await fetch(`${serverUrl}/sync/${syncId}/pull?after=${after}&limit=${limit}`);
	if (!res.ok) throw new Error(`pull failed: ${res.status}`);
	return res.json();
}

export async function serverVersion(
	serverUrl: string,
	syncId: string,
): Promise<ServerVersionInfo> {
	const res = await fetch(`${serverUrl}/sync/${syncId}/version`);
	if (!res.ok) throw new Error(`version check failed: ${res.status}`);
	return res.json();
}

async function serverPullSnapshot(
	serverUrl: string,
	syncId: string,
): Promise<{ version: number; data: Uint8Array }> {
	const res = await fetch(`${serverUrl}/sync/${syncId}/snapshot`);
	if (!res.ok) throw new Error(`snapshot pull failed: ${res.status}`);
	const version = parseInt(res.headers.get("x-snapshot-version") ?? "0", 10);
	const data = new Uint8Array(await res.arrayBuffer());
	return { version, data };
}

async function serverPushSnapshot(
	serverUrl: string,
	syncId: string,
	blob: Uint8Array,
): Promise<void> {
	const res = await fetch(`${serverUrl}/sync/${syncId}/snapshot`, {
		method: "POST",
		body: blob,
	});
	if (!res.ok) throw new Error(`snapshot push failed: ${res.status}`);
}

// --- Snapshot ---

type SnapshotPayload = {
	schemaVersion: number;
	tables: Record<string, Record<string, unknown>[]>;
};

async function collectSnapshot(
	db: DbHandle,
	schemaVersion: number,
): Promise<SnapshotPayload> {
	const payload: SnapshotPayload = { schemaVersion, tables: {} };
	for (const table of SYNC_TABLES) {
		const rows = await db.query(`SELECT * FROM ${table} WHERE deleted_at IS NULL`);
		if (rows.length > 0) {
			payload.tables[table] = rows;
		}
	}
	return payload;
}

async function applySnapshot(
	db: DbHandle,
	payload: SnapshotPayload,
	cursor: number,
): Promise<void> {
	await db.withTx(async () => {
		for (const [table, rows] of Object.entries(payload.tables)) {
			if (!rows.length) continue;
			const columns = Object.keys(rows[0]);
			const sql = buildUpsertSql(table, columns);

			for (const row of rows) {
				const pks = TABLE_PKS[table];
				const pkWhere = pks.map((pk) => `${pk} = ?`).join(" AND ");
				const pkValues = pks.map((pk) => row[pk]);

				const local = await db.query(
					`SELECT updated_at, deleted_at FROM ${table} WHERE ${pkWhere}`,
					pkValues,
				);

				if (local.length > 0) {
					if (!local[0].deleted_at && local[0].updated_at >= (row.updated_at as string)) {
						continue;
					}
				}

				const values = columns.map((c) => c === "local_seq" ? 0 : row[c]);
				await db.exec(sql, values);
			}
		}

		await db.exec("UPDATE _sync SET cursor = ?", [cursor]);
	});
}

// --- Main sync function ---

function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

const PULL_PAGE_SIZE = 100;
const SNAPSHOT_VERSION_GAP = 1000;

export async function sync(
	db: DbHandle,
	config: SyncConfig,
	schemaVersion: number,
): Promise<{ pulled: number; pushed: number }> {
	let pulled = 0;
	let pushed = 0;

	const versionInfo = await serverVersion(config.serverUrl, config.syncId);
	let { cursor } = await getSyncCounters(db);

	// 1. Snapshot pull — if server has a snapshot ahead of our cursor
	if (versionInfo.snapshot_version > cursor) {
		const snapshot = await serverPullSnapshot(config.serverUrl, config.syncId);
		const decrypted = await decrypt(snapshot.data, config.passphrase);
		const payload: SnapshotPayload = JSON.parse(decrypted);

		if (payload.schemaVersion > schemaVersion) {
			throw new Error("remote has newer schema — please update the app");
		}

		cursor = snapshot.version;
		await applySnapshot(db, payload, cursor);
		pulled++;
	}

	// 2. Incremental pull — paginated
	while (true) {
		const changesets = await serverPull(config.serverUrl, config.syncId, cursor, PULL_PAGE_SIZE);
		for (const cs of changesets) {
			const decrypted = await decrypt(base64ToBytes(cs.data), config.passphrase);
			const payload: ChangesetPayload = JSON.parse(decrypted);

			if (payload.schemaVersion > schemaVersion) {
				throw new Error("remote has newer schema — please update the app");
			}

			cursor = cs.version;
			await applyIncoming(db, payload, cursor);
			pulled++;
		}

		if (changesets.length < PULL_PAGE_SIZE) break;
	}

	// 3. Push
	const dirty = await collectDirtyRows(db, schemaVersion);
	const hasChanges =
		Object.values(dirty.upserts).some((rows) => rows.length > 0) ||
		dirty.deletes.length > 0;

	console.log({ hasChanges, dirty })

	if (hasChanges) {
		const json = JSON.stringify(dirty);
		const blob = await encrypt(json, config.passphrase);
		const version = await serverPush(config.serverUrl, config.syncId, blob);
		const { seq } = await getSyncCounters(db);
		await db.exec("UPDATE _sync SET cursor = ?, last_pushed_seq = ?", [version, seq]);
		pushed++;
	}

	// 4. Snapshot upload — if fully up to date and conditions met
	await maybeUploadSnapshot(db, config, schemaVersion, versionInfo);

	return { pulled, pushed };
}

async function maybeUploadSnapshot(
	db: DbHandle,
	config: SyncConfig,
	schemaVersion: number,
	versionInfo: ServerVersionInfo,
): Promise<void> {
	const { seq, last_pushed_seq, cursor } = await getSyncCounters(db);

	// Must be fully up to date
	if (last_pushed_seq !== seq) return;
	if (cursor !== versionInfo.version) return;

	// Trigger: 1000+ changeset versions since last snapshot
	if (versionInfo.version - versionInfo.snapshot_version < SNAPSHOT_VERSION_GAP) return;

	const snapshot = await collectSnapshot(db, schemaVersion);
	const json = JSON.stringify(snapshot);
	const blob = await encrypt(json, config.passphrase);
	await serverPushSnapshot(config.serverUrl, config.syncId, blob);
}

// --- Enable / disable sync ---

export function enableSync(config: SyncConfig): SyncConfig {
	saveSyncConfig(config);
	return config;
}
