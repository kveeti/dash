import { normalizeCurrency } from "../currency";
import type { DbHandle, DbTxHandle } from "./client";
import { id } from "../id";
import {
	ensureUniqueAccountCode,
	generateAccountCode,
	isValidAccountCode,
	normalizeAccountCode,
} from "../account-code";

export type Account = {
	id: string;
	name: string;
	currency: string;
	external_id: string | null;
	code: string;
};

export type AccountWithCount = {
	id: string;
	name: string;
	currency: string;
	external_id: string | null;
	code: string;
	tx_count: number;
};

export type AccountInput = {
	name: string;
	currency: string;
	external_id?: string | null;
	code?: string | null;
};

const ACCOUNT_SELECT_SQL = `
	select id, name, currency, external_id, code
	from accounts
	where _sync_is_deleted = 0
	order by name`;

const ACCOUNT_SELECT_WITH_COUNTS_SQL = `select a.id, a.name, a.currency, a.external_id, a.code, count(t.id) as tx_count
	from accounts a
	left join transactions t on a.id = t.account_id and t._sync_is_deleted = 0
	where a._sync_is_deleted = 0`;

export async function listAccounts(db: DbHandle): Promise<Account[]> {
	return db.query(ACCOUNT_SELECT_SQL);
}

export async function listAccountsWithCount(
	db: DbHandle,
	search?: string,
): Promise<AccountWithCount[]> {
	if (search) {
		return db.query<AccountWithCount>(
			`${ACCOUNT_SELECT_WITH_COUNTS_SQL} and a.name like ?
			 group by a.id order by a.name`,
			[`%${search}%`],
		);
	}

	return db.query<AccountWithCount>(
		`${ACCOUNT_SELECT_WITH_COUNTS_SQL}
		 group by a.id order by a.name`,
	);
}

async function takenAccountCodes(
	txDb: DbTxHandle,
	excludeId?: string,
): Promise<Set<string>> {
	const rows = excludeId
		? await txDb.query<{ code: string }>(
				"select code from accounts where _sync_is_deleted = 0 and id <> ?",
				[excludeId],
			)
		: await txDb.query<{ code: string }>(
				"select code from accounts where _sync_is_deleted = 0",
			);
	return new Set(rows.map((r) => r.code));
}

async function resolveAccountCode(
	txDb: DbTxHandle,
	desired: string | null | undefined,
	fallbackName: string,
	excludeId?: string,
): Promise<string> {
	const taken = await takenAccountCodes(txDb, excludeId);
	if (desired) {
		const normalized = normalizeAccountCode(desired);
		if (!isValidAccountCode(normalized)) {
			throw new Error("account code must be 3 alphanumeric characters");
		}
		if (taken.has(normalized)) {
			throw new Error(`account code "${normalized}" is already in use`);
		}
		return normalized;
	}
	return ensureUniqueAccountCode(generateAccountCode(fallbackName), taken);
}

export async function createAccount(
	db: DbHandle,
	account: AccountInput,
): Promise<string> {
	const newId = await db.withTx(async (txDb) => {
		const newId = id();
		const now = new Date().toISOString();
		const code = await resolveAccountCode(txDb, account.code, account.name);
		await txDb.exec(
			`insert into accounts (id, created_at, updated_at, name, currency, external_id, code, _sync_edited_at)
			values (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				newId,
				now,
				now,
				account.name,
				normalizeCurrency(account.currency),
				account.external_id?.trim() || null,
				code,
				Date.now(),
			],
		);
		return newId;
	});

	return newId;
}

export async function updateAccount(
	db: DbHandle,
	accountId: string,
	account: AccountInput,
) {
	await db.withTx(async (txDb) => {
		const now = new Date().toISOString();
		let code: string;
		if (account.code === undefined) {
			const rows = await txDb.query<{ code: string }>(
				"select code from accounts where id = ?",
				[accountId],
			);
			if (!rows.length) throw new Error(`account ${accountId} not found`);
			code = rows[0].code;
		} else {
			code = await resolveAccountCode(
				txDb,
				account.code,
				account.name,
				accountId,
			);
		}
		await txDb.exec(
			"update accounts set name = ?, currency = ?, external_id = ?, code = ?, updated_at = ?, _sync_status = 1, _sync_edited_at = ? where id = ?",
			[
				account.name,
				normalizeCurrency(account.currency),
				account.external_id?.trim() || null,
				code,
				now,
				Date.now(),
				accountId,
			],
		);
	});
}

export async function deleteAccount(
	db: DbHandle,
	accountId: string,
): Promise<boolean> {
	return db.withTx(async (txDb) => {
		const rows = await txDb.query<{ c: number }>(
			"select count(*) as c from transactions where account_id = ? and _sync_is_deleted = 0",
			[accountId],
		);
		if (rows[0].c > 0) return false;
		const now = new Date().toISOString();
		await txDb.exec(
			"update accounts set _sync_is_deleted = 1, updated_at = ?, _sync_status = 1, _sync_edited_at = ? where id = ?",
			[now, Date.now(), accountId],
		);
		return true;
	});
}

export async function getOrCreateAccountByName(
	db: DbHandle,
	name: string,
	currency = "EUR",
): Promise<string> {
	const rows = await db.query<{ id: string }>(
		"select id from accounts where name = ? and _sync_is_deleted = 0",
		[name],
	);
	if (rows.length > 0) return rows[0].id;
	return createAccount(db, { name, currency });
}
