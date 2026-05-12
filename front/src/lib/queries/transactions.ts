import {
	useQuery,
	useInfiniteQuery,
	useMutation,
	useQueryClient,
	keepPreviousData,
} from "@tanstack/react-query";
import { useI18n } from "../../providers";
import { useEncrypted } from "../../encrypted-context";
import {
	DEFAULT_TRANSACTIONS_LIMIT,
	bulkSetTransactionCategory,
	createTransaction,
	createTransactionFlow,
	deleteTransactionFlow,
	dismissTransactionLinkSuggestion,
	getOneTransaction,
	listTransactionCurrencies,
	listTransactionFlows,
	listTransactionLinkSuggestionPage,
	listTransactionLinkSuggestions,
	listTransactions,
	normalizeTransactionCursor,
	normalizeTransactionSort,
	updateTransaction,
	type SuggestedTransactionFlow,
	type TransactionCursorInput,
	type TransactionDetails,
	type TransactionFlow,
	type TransactionInput,
	type TransactionLinkSuggestion,
	type TransactionLinkSuggestionKind,
	type TransactionLinkSuggestionPageResult,
	type TransactionRow,
	type TransactionSort,
	type TransactionsResult,
	type TransactionFlowKind,
} from "../db/transactions";
import { broadcastDbChange } from "../db-change-broadcast";
import { currencyMetaQueryOptions } from "./currencies";
import { queryKeys, queryKeyRoots, type TransactionFilters } from "./query-keys";

export type {
	SuggestedTransactionFlow,
	TransactionDetails,
	TransactionFlow,
	TransactionFlowKind,
	TransactionInput,
	TransactionLinkSuggestion,
	TransactionLinkSuggestionKind,
	TransactionLinkSuggestionPageResult,
	TransactionRow,
	TransactionSort,
	TransactionsResult,
};

function invalidateTransactionQueries(qc: ReturnType<typeof useQueryClient>) {
	qc.invalidateQueries({ queryKey: queryKeyRoots.transactions });
	qc.invalidateQueries({ queryKey: queryKeyRoots.transaction });
	qc.invalidateQueries({ queryKey: queryKeyRoots.stats });
	broadcastDbChange(["transactions", "transaction", "stats"]);
}

function invalidateFlowQueries(qc: ReturnType<typeof useQueryClient>) {
	qc.invalidateQueries({ queryKey: queryKeyRoots.transactionFlows });
	qc.invalidateQueries({ queryKey: queryKeyRoots.transactionLinkSuggestions });
	qc.invalidateQueries({ queryKey: queryKeyRoots.stats });
	invalidateTransactionQueries(qc);
	broadcastDbChange(["transactionFlows", "transactionLinkSuggestions"]);
}

export function useTransactionsQuery(props: {
	search: string | undefined;
	filters?: TransactionFilters;
	cursor?: TransactionCursorInput;
	sort?: TransactionSort;
}) {
	const { db } = useEncrypted();
	const cursor = normalizeTransactionCursor(props.cursor);
	const sort = normalizeTransactionSort(props.sort);

	return useQuery({
		queryKey: queryKeys.transactions(props.search, props.filters, cursor, sort),
		queryFn: () =>
			listTransactions(db, {
				cursor,
				sort,
				search: props.search,
				filters: props.filters,
				limit: DEFAULT_TRANSACTIONS_LIMIT,
			}),
		placeholderData: keepPreviousData,
	});
}

export function useTransactionQuery(id: string | undefined) {
	const { db } = useEncrypted();
	return useQuery({
		queryKey: queryKeys.transaction(id),
		queryFn: () => getOneTransaction(db, id!),
		enabled: !!id,
	});
}

export function useCreateTransactionMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (tx: TransactionInput) =>
			qc
				.ensureQueryData(currencyMetaQueryOptions(db))
				.then((currencyMeta) => createTransaction(db, tx, currencyMeta)),
		onSuccess: () => invalidateTransactionQueries(qc),
	});
}

export function useUpdateTransactionMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			txId,
			tx,
		}: {
			txId: string;
			tx: TransactionInput;
		}) =>
			qc
				.ensureQueryData(currencyMetaQueryOptions(db))
				.then((currencyMeta) => updateTransaction(db, txId, tx, currencyMeta)),
		onSuccess: () => invalidateTransactionQueries(qc),
	});
}

export function useTransactionFlowsQuery(txId: string | undefined) {
	const { db } = useEncrypted();
	return useQuery({
		queryKey: queryKeys.transactionFlows(txId),
		queryFn: () => listTransactionFlows(db, txId!),
		enabled: !!txId,
	});
}

export function useTransactionLinkSuggestionsQuery(txId: string | undefined) {
	const { db } = useEncrypted();
	const { f } = useI18n();
	return useQuery({
		queryKey: queryKeys.transactionLinkSuggestions(txId),
		queryFn: () => listTransactionLinkSuggestions(db, txId!, f.amount),
		enabled: !!txId,
	});
}

export function useTransactionLinkSuggestionPageQuery(cursor?: {
	beforeDate?: string;
	beforeId?: string;
}) {
	const { db } = useEncrypted();
	const { f } = useI18n();
	return useInfiniteQuery({
		queryKey: queryKeys.transactionLinkSuggestionsPage(cursor),
		queryFn: ({ pageParam }) =>
			listTransactionLinkSuggestionPage(db, f.amount, pageParam),
		initialPageParam: cursor,
		getNextPageParam: (lastPage) =>
			lastPage.next_cursor
				? {
						beforeDate: lastPage.next_cursor.before_date,
						beforeId: lastPage.next_cursor.before_id,
					}
				: undefined,
	});
}

export function useTransactionCurrenciesQuery() {
	const { db } = useEncrypted();
	return useQuery({
		queryKey: [...queryKeyRoots.transactions, "currencies"],
		queryFn: () => listTransactionCurrencies(db),
	});
}

export function useCreateTransactionFlowMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (flow: SuggestedTransactionFlow) =>
			qc
				.ensureQueryData(currencyMetaQueryOptions(db))
				.then((currencyMeta) => createTransactionFlow(db, flow, currencyMeta)),
		onSuccess: () => invalidateFlowQueries(qc),
	});
}

export function useDeleteTransactionFlowMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ flowId }: { flowId: string }) =>
			deleteTransactionFlow(db, flowId),
		onSuccess: () => invalidateFlowQueries(qc),
	});
}

export function useDismissTransactionLinkSuggestionMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			kind: TransactionLinkSuggestionKind;
			primaryTransactionId: string;
			candidateIds: string[];
		}) => dismissTransactionLinkSuggestion(db, input),
		onSuccess: () => invalidateFlowQueries(qc),
	});
}

export function useBulkSetCategoryMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			txIds: string[];
			categoryId: string | null;
		}) => bulkSetTransactionCategory(db, input),
		onSuccess: () => invalidateTransactionQueries(qc),
	});
}
