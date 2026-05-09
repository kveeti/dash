import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEncrypted } from "../../encrypted-context";
import {
	createAccount,
	deleteAccount,
	getOrCreateAccountByName,
	listAccounts,
	listAccountsWithCount,
	updateAccount,
	type Account,
	type AccountInput,
	type AccountWithCount,
} from "../db/accounts";
import { broadcastDbChange } from "../db-change-broadcast";
import { queryKeys, queryKeyRoots } from "./query-keys";

export type { Account, AccountWithCount };
export { getOrCreateAccountByName };

function invalidateAccountsQuery(qc: ReturnType<typeof useQueryClient>) {
	qc.invalidateQueries({ queryKey: queryKeyRoots.accounts });
	broadcastDbChange(["accounts"]);
}

export function useAccountsQuery() {
	const { db } = useEncrypted();
	return useQuery({
		queryKey: queryKeys.accounts(),
		queryFn: () => listAccounts(db),
	});
}

export function useAccountsWithCountQuery(search?: string) {
	const { db } = useEncrypted();
	return useQuery({
		queryKey: [...queryKeyRoots.accounts, "with-count", search],
		queryFn: () => listAccountsWithCount(db, search),
	});
}

export function useCreateAccountMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (account: AccountInput) =>
			createAccount(db, account),
		onSuccess: () => invalidateAccountsQuery(qc),
	});
}

export function useUpdateAccountMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, ...account }: { id: string } & AccountInput) =>
			updateAccount(db, id, account),
		onSuccess: () => invalidateAccountsQuery(qc),
	});
}

export function useDeleteAccountMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteAccount(db, id),
		onSuccess: () => invalidateAccountsQuery(qc),
	});
}
