import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDb } from "../../providers";
import type { DbHandle } from "../db";
import { id } from "../id";
import { queryKeys, queryKeyRoots } from "./query-keys";

export type Account = {
	id: string;
	name: string;
};

const ACCOUNT_SELECT_SQL =
	"select id, name from accounts where _sync_is_deleted = 0 order by name";

export function useAccountsQuery() {
	const db = useDb();
	return useQuery({
		queryKey: queryKeys.accounts(),
		queryFn: () => getAccounts(db),
	});
}

export function useCreateAccountMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (name: string) => createAccount(db, name),
		onSuccess: () => qc.invalidateQueries({ queryKey: queryKeyRoots.accounts }),
	});
}

export async function getAccounts(db: DbHandle): Promise<Account[]> {
	return db.query(ACCOUNT_SELECT_SQL);
}

export async function createAccount(
	db: DbHandle,
	name: string,
): Promise<string> {
	const newId = await db.withTx(async () => {
		const newId = id();
		const now = new Date().toISOString();
		await db.exec(
			`insert into accounts (id, created_at, updated_at, name, _sync_hlc)
			values (?, ?, ?, ?, ?)`,
			[newId, now, now, name, db.hlc.generate()],
		);
		return newId;
	});

	return newId;
}

export async function getOrCreateAccountByName(
	db: DbHandle,
	name: string,
): Promise<string> {
	const rows = await db.query<{ id: string }>(
		"select id from accounts where name = ? and _sync_is_deleted = 0",
		[name],
	);
	if (rows.length > 0) return rows[0].id;
	return createAccount(db, name);
}
