import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDb } from "../../providers";
import type { DbHandle } from "../db";
import { id } from "../id";
import { nextSeq } from "../sync";

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
	return db.query("select id, name from accounts where deleted_at is null order by name");
}

export async function createAccount(
	db: DbHandle,
	name: string
): Promise<string> {
	return db.withTx(async () => {
		const newId = id();
		const now = new Date().toISOString();
		const seq = await nextSeq(db);
		await db.exec(
			"insert into accounts (id, created_at, updated_at, name, local_seq) values (?, ?, ?, ?, ?)",
			[newId, now, now, name, seq],
		);
		return newId;
	});
}

export async function getOrCreateAccountByName(
	db: DbHandle,
	name: string
): Promise<string> {
	const rows = await db.query<{ id: string }>(
		"select id from accounts where name = ? and deleted_at is null",
		[name],
	);
	if (rows.length > 0) return rows[0].id;
	return createAccount(db, name);
}
