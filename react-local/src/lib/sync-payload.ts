/**
 * Conversion between local DB rows and sync payloads.
 *
 * v1 payload format (inside encrypted blob):
 * { "table": "transactions", "data": { ...business fields... } }
 *
 * Sync metadata (id, hlc, is_deleted, schema_version) is stored
 * unencrypted on the server — only business data is in the blob.
 */

import type { DbHandle } from "./db";
import { makeHlc } from "./hlc";
import { getMaxHlc } from "./queries/transactions";

export const SCHEMA_VERSION = 1;

/** The 4 syncable tables */
export const SYNCABLE_TABLES = [
	"categories",
	"accounts",
	"transactions",
	"transaction_links",
] as const;

export type SyncableTable = (typeof SYNCABLE_TABLES)[number];

/** Business-data fields per table (everything except sync metadata) */
const TABLE_FIELDS: Record<SyncableTable, string[]> = {
	categories: ["id", "name", "is_neutral"],
	accounts: ["id", "name"],
	transactions: [
		"id",
		"date",
		"categorize_on",
		"amount",
		"currency",
		"counter_party",
		"additional",
		"notes",
		"category_id",
		"account_id",
	],
	transaction_links: ["transaction_a_id", "transaction_b_id"],
};

/** item_id used on the server — PK of the row */
export function itemId(table: SyncableTable, row: Record<string, any>): string {
	if (table === "transaction_links") {
		return `txlink:${row.transaction_a_id}:${row.transaction_b_id}`;
	}
	return `${table}:${row.id}`;
}

/** Parse a server item_id back to table + local key(s) */
export function parseItemId(id: string): { table: SyncableTable; keys: Record<string, string> } {
	if (id.startsWith("txlink:")) {
		const [, a, b] = id.split(":");
		return { table: "transaction_links", keys: { transaction_a_id: a, transaction_b_id: b } };
	}
	const colonIdx = id.indexOf(":");
	const table = id.slice(0, colonIdx) as SyncableTable;
	const pk = id.slice(colonIdx + 1);
	return { table, keys: { id: pk } };
}

export type SyncPayload = {
	table: SyncableTable;
	data: Record<string, any>;
};

/** Extract business fields from a local row → payload JSON */
export function rowToPayload(table: SyncableTable, row: Record<string, any>): SyncPayload {
	const fields = TABLE_FIELDS[table];
	const data: Record<string, any> = {};
	for (const f of fields) {
		data[f] = row[f] ?? null;
	}
	return { table, data };
}

/** Get all dirty rows for a given table */
export async function getDirtyItems(
	db: DbHandle,
	table: SyncableTable,
): Promise<Record<string, any>[]> {
	const fields = [...TABLE_FIELDS[table], "hlc", "is_deleted"];
	return db.query(
		`select ${fields.join(", ")} from ${table} where is_dirty = 1`,
	);
}

/** Upsert a row received from sync (incoming won HLC comparison) */
export async function upsertFromSync(
	db: DbHandle,
	table: SyncableTable,
	data: Record<string, any>,
	hlc: string,
	isDeleted: boolean,
): Promise<void> {
	const fields = TABLE_FIELDS[table];
	const now = new Date().toISOString();

	if (table === "transaction_links") {
		// Composite PK table
		const cols = [...fields, "hlc", "is_deleted", "is_dirty", "created_at"];
		const placeholders = cols.map(() => "?").join(", ");
		const updateSet = ["hlc", "is_deleted", "is_dirty"]
			.map((c) => `${c} = excluded.${c}`)
			.join(", ");

		await db.exec(
			`insert into transaction_links (${cols.join(", ")})
			 values (${placeholders})
			 on conflict (transaction_a_id, transaction_b_id) do update set ${updateSet}`,
			[
				data.transaction_a_id,
				data.transaction_b_id,
				hlc,
				isDeleted ? 1 : 0,
				0, // is_dirty = 0 (came from server)
				now,
			],
		);
		return;
	}

	// Single PK tables (categories, accounts, transactions)
	const hasTimestamps = true; // all 3 have created_at/updated_at
	const cols = [...fields, "hlc", "is_deleted", "is_dirty"];
	if (hasTimestamps) cols.push("created_at", "updated_at");

	const placeholders = cols.map(() => "?").join(", ");
	const updateCols = cols.filter((c) => c !== "id" && c !== "created_at");
	const updateSet = updateCols.map((c) => `${c} = excluded.${c}`).join(", ");

	const values = [
		...fields.map((f) => data[f] ?? null),
		hlc,
		isDeleted ? 1 : 0,
		0, // is_dirty = 0
	];
	if (hasTimestamps) values.push(now, now);

	await db.exec(
		`insert into ${table} (${cols.join(", ")})
		 values (${placeholders})
		 on conflict (id) do update set ${updateSet}`,
		values,
	);
}

/**
 * Cascade tombstones: when an account or category is deleted via sync,
 * mark dependent local rows as deleted + dirty so they get pushed.
 */
export async function cascadeTombstone(
	db: DbHandle,
	table: SyncableTable,
	data: Record<string, any>,
): Promise<void> {
	if (table === "accounts") {
		const hlc = makeHlc(Date.now(), await getMaxHlc(db));
		await db.exec(
			`update transactions set is_deleted = 1, is_dirty = 1, hlc = ?
			 where account_id = ? and is_deleted = 0`,
			[hlc, data.id],
		);
	} else if (table === "categories") {
		// Don't delete transactions when category is deleted — just null out category_id
		const hlc = makeHlc(Date.now(), await getMaxHlc(db));
		await db.exec(
			`update transactions set category_id = null, is_dirty = 1, hlc = ?
			 where category_id = ? and is_deleted = 0`,
			[hlc, data.id],
		);
	}
}

/** Clear dirty flag for a specific item after successful push */
export async function clearDirtyFlag(
	db: DbHandle,
	table: SyncableTable,
	keys: Record<string, string>,
): Promise<void> {
	if (table === "transaction_links") {
		await db.exec(
			`update transaction_links set is_dirty = 0
			 where transaction_a_id = ? and transaction_b_id = ?`,
			[keys.transaction_a_id, keys.transaction_b_id],
		);
	} else {
		await db.exec(
			`update ${table} set is_dirty = 0 where id = ?`,
			[keys.id],
		);
	}
}
