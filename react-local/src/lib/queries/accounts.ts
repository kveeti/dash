import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDb } from "../../providers";
import type { DbHandle } from "../db";
import { id } from "../id";

export type Account = {
	id: string;
	name: string;
};

export function useAccountsQuery() {
	const db = useDb();
	return useQuery({
		queryKey: ["accounts"],
		queryFn: () => getAccounts(db),
	});
}

export function useCreateAccountMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (name: string) => createAccount(db, name),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
	});
}

export async function getAccounts(db: DbHandle): Promise<Account[]> {
	return db.query("select id, name from accounts order by name");
}

export async function createAccount(
	db: DbHandle,
	name: string
): Promise<string> {
	const newId = id();
	const now = new Date().toISOString();
	await db.exec("insert into accounts (id, created_at, name) values (?, ?, ?)", [newId, now, name]);
	return newId;
}

export async function getOrCreateAccountByName(
	db: DbHandle,
	name: string
): Promise<string> {
	const rows = await db.query<{ id: string }>("select id from accounts where name = ?", [name]);
	if (rows.length > 0) return rows[0].id;
	return createAccount(db, name);
}
