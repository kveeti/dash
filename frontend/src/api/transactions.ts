import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";

import { useI18n } from "../features/i18n/use-i18n";
import { api } from "./api";
import type { Bucket, BucketKind } from "./buckets";
import { restoreQueries, type QuerySnapshot } from "./query-snapshot";

export const transactionKeys = {
  all: ["transactions"] as const,
  lists: ["transactions", "list"] as const,
  list: ({
    searchQuery,
    tag,
    timezone,
  }: {
    searchQuery?: string;
    tag?: string;
    timezone: string;
  }) => [...transactionKeys.lists, searchQuery, tag, timezone] as const,
  details: ["transactions", "detail"] as const,
  detail: (id: string) => [...transactionKeys.details, id] as const,
};

export const tagKeys = {
  all: ["tags"] as const,
};

export interface Posting {
  id: string;
  bucket: {
    id: string;
    name: string;
    kind: BucketKind;
  };
  amount: number;
  currency: string;
  stats_date: string | null;
  memo: string;
  imported: boolean;
  tags: string[];
}

export interface Transaction {
  id: string;
  occurred_at: string;
  counterparty: string;
  description: string;
  memo: string;
  postings: Posting[];
  transfer?: {
    match_id?: string;
    side?: "outgoing" | "incoming";
    counterpart_id?: string;
    counterpart_occurred_at?: string;
    counterpart_bucket?: Posting["bucket"];
    counterpart_amount?: number;
    counterpart_currency?: string;
    unmatched?: boolean;
  };
  /** A view of all posting tags, derived from the postings. */
  tags: string[];
}

interface Cursor {
  date: string;
  id: string;
}

export interface TransactionsPage {
  transactions: Transaction[];
  next_cursor: Cursor | null;
}

type TransactionsData = InfiniteData<TransactionsPage>;
type TransactionSnapshot = QuerySnapshot<TransactionsData | Transaction>;
type TransactionWire = Omit<Transaction, "tags">;

function withTags(transaction: TransactionWire): Transaction {
  return {
    ...transaction,
    tags: [...new Set(transaction.postings.flatMap((posting) => posting.tags))],
  };
}

function updateTransactions(
  data: TransactionsData | undefined,
  update: (transaction: Transaction) => Transaction | null,
) {
  return (
    data && {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        transactions: page.transactions.flatMap((transaction) => {
          const updated = update(transaction);
          return updated ? [updated] : [];
        }),
      })),
    }
  );
}

function updateTransactionCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (transaction: Transaction) => Transaction | null,
) {
  queryClient.setQueriesData<TransactionsData>(
    { queryKey: transactionKeys.lists },
    (data) => updateTransactions(data, update),
  );
  queryClient.setQueriesData<Transaction>(
    { queryKey: transactionKeys.details },
    (transaction) =>
      transaction ? (update(transaction) ?? undefined) : transaction,
  );
}

async function snapshotTransactions(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<TransactionSnapshot> {
  await queryClient.cancelQueries({ queryKey: transactionKeys.all });
  return queryClient.getQueriesData<TransactionsData | Transaction>({
    queryKey: transactionKeys.all,
  });
}

function invalidateRelated(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: transactionKeys.all });
  queryClient.invalidateQueries({ queryKey: ["stats"] });
}

export function useInfiniteTransactionsQuery(props: {
  searchQuery?: string;
  tag?: string;
}) {
  const { timeZone } = useI18n();
  return useInfiniteQuery({
    queryKey: transactionKeys.list({
      searchQuery: props.searchQuery,
      tag: props.tag,
      timezone: timeZone,
    }),
    queryFn: ({ pageParam }: { pageParam: Cursor | null }) => {
      const params = new URLSearchParams();
      if (pageParam) {
        params.set("before_date", pageParam.date);
        params.set("before_id", pageParam.id);
      }
      if (props.searchQuery) params.set("q", props.searchQuery);
      if (props.tag) params.set("tag", props.tag);
      params.set("timezone", timeZone);

      return api<
        Omit<TransactionsPage, "transactions"> & {
          transactions: TransactionWire[];
        }
      >(
        `/api/v1/transactions${params.size ? `?${params.toString()}` : ""}`,
      ).then((page) => ({
        ...page,
        transactions: page.transactions.map(withTags),
      }));
    },
    initialPageParam: null as Cursor | null,
    getNextPageParam: (last: TransactionsPage) => last.next_cursor,
    placeholderData: keepPreviousData,
  });
}

export function useTransactionQuery(id: string) {
  return useQuery({
    queryKey: transactionKeys.detail(id),
    queryFn: () =>
      api<TransactionWire>(`/api/v1/transactions/${id}`).then(withTags),
  });
}

export function usePatchTransactionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; memo: string }) =>
      api<TransactionWire>(`/api/v1/transactions/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify({ memo: input.memo }),
      }).then(withTags),
    onMutate: async (input) => {
      const previous = await snapshotTransactions(queryClient);
      updateTransactionCaches(queryClient, (transaction) =>
        transaction.id === input.id
          ? { ...transaction, ...input }
          : transaction,
      );
      return { previous };
    },
    onError: (_error, _input, context) =>
      restoreQueries(queryClient, context?.previous ?? []),
    onSuccess: (transaction) =>
      updateTransactionCaches(queryClient, (current) =>
        current.id === transaction.id ? transaction : current,
      ),
    onSettled: () => invalidateRelated(queryClient),
  });
}

export function useCategorizePostingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      transactionId: string;
      postingId: string;
      bucket: Posting["bucket"];
    }) =>
      api<{ updated: boolean }>(`/api/v1/postings/${input.postingId}`, {
        method: "PATCH",
        body: JSON.stringify({ bucket_id: input.bucket.id }),
      }),
    onMutate: async (input) => {
      const previous = await snapshotTransactions(queryClient);
      updateTransactionCaches(queryClient, (transaction) => {
        if (transaction.id !== input.transactionId) return transaction;
        return {
          ...transaction,
          postings: transaction.postings.map((posting) =>
            posting.id === input.postingId
              ? { ...posting, bucket: input.bucket }
              : posting,
          ),
        };
      });
      return { previous };
    },
    onError: (_error, _input, context) =>
      restoreQueries(queryClient, context?.previous ?? []),
    onSettled: () => invalidateRelated(queryClient),
  });
}

export function useBulkCategorizeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { ids: string[]; bucket: Bucket }) =>
      api<{ categorized: number }>("/api/v1/transactions/categorize", {
        method: "POST",
        body: JSON.stringify({
          transaction_ids: input.ids,
          bucket_id: input.bucket.id,
        }),
      }),
    onMutate: async (input) => {
      const previous = await snapshotTransactions(queryClient);
      const ids = new Set(input.ids);
      const categoryKinds: BucketKind[] = ["expense", "income", "person"];
      updateTransactionCaches(queryClient, (transaction) => {
        if (!ids.has(transaction.id)) return transaction;
        const categoryPostings = transaction.postings.filter((posting) =>
          categoryKinds.includes(posting.bucket.kind),
        );
        if (categoryPostings.length !== 1) return transaction;
        const categoryPosting = categoryPostings[0];
        return {
          ...transaction,
          postings: transaction.postings.map((posting) =>
            posting === categoryPosting
              ? { ...posting, bucket: input.bucket }
              : posting,
          ),
        };
      });
      return { previous };
    },
    onError: (_error, _input, context) =>
      restoreQueries(queryClient, context?.previous ?? []),
    onSettled: () => invalidateRelated(queryClient),
  });
}

export function useTagsQuery(searchQuery = "") {
  const query = searchQuery.trim().toLocaleLowerCase();

  return useQuery({
    queryKey: [...tagKeys.all, query],
    queryFn: ({ signal }) =>
      api<{ tags: string[] }>(`/api/v1/tags?q=${encodeURIComponent(query)}`, {
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

function updatePostingTags(
  queryClient: ReturnType<typeof useQueryClient>,
  ids: Set<string>,
  update: (tags: string[]) => string[],
) {
  updateTransactionCaches(queryClient, (transaction) => {
    if (!transaction.postings.some((posting) => ids.has(posting.id))) {
      return transaction;
    }
    const postings = transaction.postings.map((posting) =>
      ids.has(posting.id)
        ? { ...posting, tags: update(posting.tags) }
        : posting,
    );
    return {
      ...transaction,
      postings,
      tags: [...new Set(postings.flatMap((posting) => posting.tags))],
    };
  });
}

export function useAddTransactionTagMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { ids: string[]; value: string }) =>
      api<{ tagged: number }>("/api/v1/transactions/tags", {
        method: "POST",
        body: JSON.stringify({ posting_ids: input.ids, tag: input.value }),
      }),
    onMutate: async (input) => {
      const previous = await snapshotTransactions(queryClient);
      updatePostingTags(queryClient, new Set(input.ids), (tags) =>
        tags.includes(input.value) ? tags : [...tags, input.value].sort(),
      );
      return { previous };
    },
    onError: (_error, _input, context) =>
      restoreQueries(queryClient, context?.previous ?? []),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
}

export function useRemoveTransactionTagMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { ids: string[]; value: string }) =>
      api<{ untagged: number }>("/api/v1/transactions/tags", {
        method: "DELETE",
        body: JSON.stringify({ posting_ids: input.ids, tag: input.value }),
      }),
    onMutate: async (input) => {
      const previous = await snapshotTransactions(queryClient);
      updatePostingTags(queryClient, new Set(input.ids), (tags) =>
        tags.filter((tag) => tag !== input.value),
      );
      return { previous };
    },
    onError: (_error, _input, context) =>
      restoreQueries(queryClient, context?.previous ?? []),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
}

export function removeTransactions(ids: string[]) {
  return api<{ removed: number; restored: number }>("/api/v1/transactions", {
    method: "DELETE",
    body: JSON.stringify({ transaction_ids: ids }),
  });
}

export function useRemoveTransactionsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeTransactions,
    onMutate: async (ids) => {
      const previous = await snapshotTransactions(queryClient);
      const removed = new Set(ids);
      updateTransactionCaches(queryClient, (transaction) =>
        removed.has(transaction.id) ? null : transaction,
      );
      return { previous };
    },
    onError: (_error, _input, context) =>
      restoreQueries(queryClient, context?.previous ?? []),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: transactionKeys.all }),
  });
}

export function useDeleteTransactionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/api/v1/transactions/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      const previous = await snapshotTransactions(queryClient);
      updateTransactionCaches(queryClient, (transaction) =>
        transaction.id === id ? null : transaction,
      );
      return { previous };
    },
    onError: (_error, _input, context) =>
      restoreQueries(queryClient, context?.previous ?? []),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: transactionKeys.all }),
  });
}

export function useUnmatchTransferMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (matchId: string) =>
      api<{ restored: number }>(`/api/v1/transfer-matches/${matchId}`, {
        method: "DELETE",
      }),
    onMutate: async (matchId) => {
      const previous = await snapshotTransactions(queryClient);
      updateTransactionCaches(queryClient, (transaction) =>
        transaction.transfer?.match_id === matchId ? null : transaction,
      );
      return { previous };
    },
    onError: (_error, _input, context) =>
      restoreQueries(queryClient, context?.previous ?? []),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: transactionKeys.all }),
  });
}
