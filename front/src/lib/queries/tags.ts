import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEncrypted } from "../../encrypted-context";
import { broadcastDbChange } from "../db-change-broadcast";
import {
	addTransactionTag,
	bulkAddTransactionTag,
	bulkRemoveTransactionTag,
	createTag,
	listTagOptions,
	listTags,
	removeTransactionTag,
	type Tag,
	type TagOption,
	type TransactionTag,
} from "../db/tags";
import { queryKeys, queryKeyRoots } from "./query-keys";

export type { Tag, TagOption, TransactionTag };

function invalidateTagQueries(qc: ReturnType<typeof useQueryClient>) {
	qc.invalidateQueries({ queryKey: queryKeyRoots.tags });
	qc.invalidateQueries({ queryKey: queryKeyRoots.transactions });
	qc.invalidateQueries({ queryKey: queryKeyRoots.transaction });
	qc.invalidateQueries({ queryKey: queryKeyRoots.stats });
	broadcastDbChange(["tags", "transactions", "transaction", "stats"]);
}

export function useTagsQuery(search?: string) {
	const { db } = useEncrypted();
	return useQuery({
		queryKey: queryKeys.tags(search),
		queryFn: () => listTags(db, search),
	});
}

export function useTagOptionsQuery() {
	const { db } = useEncrypted();
	return useQuery({
		queryKey: queryKeys.tagOptions(),
		queryFn: () => listTagOptions(db),
	});
}

export function useCreateTagMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (name: string) => createTag(db, name),
		onSuccess: () => invalidateTagQueries(qc),
	});
}

export function useAddTransactionTagMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: { txId: string; tagId: string }) =>
			addTransactionTag(db, input),
		onSuccess: () => invalidateTagQueries(qc),
	});
}

export function useRemoveTransactionTagMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: { txId: string; tagId: string }) =>
			removeTransactionTag(db, input),
		onSuccess: () => invalidateTagQueries(qc),
	});
}

export function useBulkAddTransactionTagMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: { txIds: string[]; tagId: string }) =>
			bulkAddTransactionTag(db, input),
		onSuccess: () => invalidateTagQueries(qc),
	});
}

export function useBulkRemoveTransactionTagMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: { txIds: string[]; tagId: string }) =>
			bulkRemoveTransactionTag(db, input),
		onSuccess: () => invalidateTagQueries(qc),
	});
}
