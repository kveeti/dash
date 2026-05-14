import { id } from "../id";
import type { DbHandle, DbSqlHandle } from "./client";

export type Tag = {
	id: string;
	name: string;
	tx_count: number;
};

export type TagOption = {
	id: string;
	name: string;
};

export type TransactionTag = {
	id: string;
	name: string;
};

function normalizeTagName(name: string) {
	return name.trim().replace(/\s+/g, " ");
}

export function transactionTagId(transactionId: string, tagId: string) {
	return `${transactionId}_${tagId}`;
}

export async function listTags(db: DbHandle, search?: string): Promise<Tag[]> {
	const trimmedSearch = search?.trim();
	const params = trimmedSearch ? [`%${trimmedSearch}%`] : [];
	return db.query<Tag>(
		`select
			t.id,
			t.name,
			count(tx.id) as tx_count
		from tags t
		left join transaction_tags tt
			on tt.tag_id = t.id
			and tt._sync_is_deleted = 0
		left join transactions tx
			on tx.id = tt.transaction_id
			and tx._sync_is_deleted = 0
		where t._sync_is_deleted = 0
			${trimmedSearch ? "and t.name like ?" : ""}
		group by t.id
		order by lower(t.name) asc`,
		params,
	);
}

export async function listTagOptions(db: DbHandle): Promise<TagOption[]> {
	return db.query<TagOption>(
		`select id, name
		from tags
		where _sync_is_deleted = 0
		order by lower(name) asc`,
	);
}

export async function listTransactionTags(
	db: DbSqlHandle,
	txId: string,
): Promise<TransactionTag[]> {
	return db.query<TransactionTag>(
		`select t.id, t.name
		from transaction_tags tt
		join tags t on t.id = tt.tag_id
		where tt.transaction_id = ?
			and tt._sync_is_deleted = 0
			and t._sync_is_deleted = 0
		order by lower(t.name) asc`,
		[txId],
	);
}

export async function getOrCreateTagByName(
	db: DbHandle,
	rawName: string,
): Promise<string> {
	const name = normalizeTagName(rawName);
	if (!name) throw new Error("tag name is required");

	return db.withTx(async (txDb) => {
		const existing = await txDb.query<{ id: string }>(
			`select id
			from tags
			where lower(name) = lower(?)
				and _sync_is_deleted = 0
			limit 1`,
			[name],
		);
		if (existing[0]) return existing[0].id;

		const now = new Date().toISOString();
		const newId = id();
		await txDb.exec(
			`insert into tags (
				id, created_at, updated_at, name, _sync_edited_at
			)
			values (?, ?, ?, ?, ?)`,
			[newId, now, now, name, Date.now()],
		);
		return newId;
	});
}

export async function createTag(db: DbHandle, rawName: string): Promise<string> {
	return getOrCreateTagByName(db, rawName);
}

export async function updateTag(db: DbHandle, tagId: string, rawName: string) {
	const name = normalizeTagName(rawName);
	if (!name) throw new Error("tag name is required");
	const now = new Date().toISOString();
	await db.exec(
		`update tags set
			name = ?,
			updated_at = ?,
			_sync_status = 1,
			_sync_edited_at = ?
		where id = ?`,
		[name, now, Date.now(), tagId],
	);
}

export async function deleteTag(db: DbHandle, tagId: string) {
	const now = new Date().toISOString();
	const editedAt = Date.now();
	await db.withTx(async (txDb) => {
		await txDb.exec(
			`update tags set
				_sync_is_deleted = 1,
				updated_at = ?,
				_sync_status = 1,
				_sync_edited_at = ?
			where id = ?`,
			[now, editedAt, tagId],
		);
		await txDb.exec(
			`update transaction_tags set
				_sync_is_deleted = 1,
				updated_at = ?,
				_sync_status = 1,
				_sync_edited_at = ?
			where tag_id = ?
				and _sync_is_deleted = 0`,
			[now, editedAt, tagId],
		);
	});
}

export async function addTransactionTag(
	db: DbHandle,
	input: { txId: string; tagId: string },
) {
	const now = new Date().toISOString();
	const editedAt = Date.now();
	await db.exec(
		`insert into transaction_tags (
			id, transaction_id, tag_id, created_at, updated_at, _sync_edited_at
		)
		values (?, ?, ?, ?, ?, ?)
		on conflict(id) do update set
			updated_at = excluded.updated_at,
			_sync_is_deleted = 0,
			_sync_status = 1,
			_sync_edited_at = excluded._sync_edited_at`,
		[
			transactionTagId(input.txId, input.tagId),
			input.txId,
			input.tagId,
			now,
			now,
			editedAt,
		],
	);
}

export async function removeTransactionTag(
	db: DbHandle,
	input: { txId: string; tagId: string },
) {
	await db.exec(
		`update transaction_tags set
			updated_at = ?,
			_sync_is_deleted = 1,
			_sync_status = 1,
			_sync_edited_at = ?
		where id = ?`,
		[
			new Date().toISOString(),
			Date.now(),
			transactionTagId(input.txId, input.tagId),
		],
	);
}

export async function bulkAddTransactionTag(
	db: DbHandle,
	input: { txIds: string[]; tagId: string },
) {
	const uniqueTxIds = Array.from(new Set(input.txIds)).filter(Boolean);
	if (!uniqueTxIds.length) return;
	const now = new Date().toISOString();
	const editedAt = Date.now();
	await db.withTx(async (txDb) => {
		for (const txId of uniqueTxIds) {
			await txDb.exec(
				`insert into transaction_tags (
					id, transaction_id, tag_id, created_at, updated_at, _sync_edited_at
				)
				values (?, ?, ?, ?, ?, ?)
				on conflict(id) do update set
					updated_at = excluded.updated_at,
					_sync_is_deleted = 0,
					_sync_status = 1,
					_sync_edited_at = excluded._sync_edited_at`,
				[
					transactionTagId(txId, input.tagId),
					txId,
					input.tagId,
					now,
					now,
					editedAt,
				],
			);
		}
	});
}

export async function bulkRemoveTransactionTag(
	db: DbHandle,
	input: { txIds: string[]; tagId: string },
) {
	const uniqueTxIds = Array.from(new Set(input.txIds)).filter(Boolean);
	if (!uniqueTxIds.length) return;
	const ids = uniqueTxIds.map((txId) => transactionTagId(txId, input.tagId));
	const placeholders = ids.map(() => "?").join(", ");
	await db.exec(
		`update transaction_tags set
			updated_at = ?,
			_sync_is_deleted = 1,
			_sync_status = 1,
			_sync_edited_at = ?
		where id in (${placeholders})`,
		[new Date().toISOString(), Date.now(), ...ids],
	);
}
