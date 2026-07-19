import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";

import { api } from "./api";
import type { Bucket, BucketKind } from "./buckets";
import { restoreQueries } from "./query-snapshot";

export const transactionKeys = {
  all: ["transactions"] as const,
  list: ({ searchQuery, tag }: { searchQuery?: string; tag?: string }) =>
    [...transactionKeys.all, "list", searchQuery, tag] as const,
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
}

export interface Transaction {
  id: string;
  date: string;
  counterparty: string;
  description: string;
  tags: string[];
  postings: Posting[];
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

async function snapshotTransactions(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  await queryClient.cancelQueries({ queryKey: transactionKeys.all });
  return queryClient.getQueriesData<TransactionsData>({
    queryKey: transactionKeys.all,
  });
}

export interface PostingInput {
  bucket_id: string;
  amount: number;
  currency: string;
}

export function useInfiniteTransactionsQuery(props: {
  searchQuery?: string;
  tag?: string;
}) {
  return useInfiniteQuery({
    queryKey: transactionKeys.list({
      searchQuery: props.searchQuery,
      tag: props.tag,
    }),
    queryFn: ({ pageParam }: { pageParam: Cursor | null }) => {
      const params = new URLSearchParams();
      if (pageParam) {
        params.set("before_date", pageParam.date);
        params.set("before_id", pageParam.id);
      }
      if (props.searchQuery) params.set("q", props.searchQuery);
      if (props.tag) params.set("tag", props.tag);

      return api<TransactionsPage>(
        `/api/v1/transactions${params.size ? `?${params.toString()}` : ""}`,
      );
    },
    initialPageParam: null as Cursor | null,
    getNextPageParam: (last: TransactionsPage) => last.next_cursor,
    placeholderData: keepPreviousData,
  });
}

export function useCreateTransactionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      date: string;
      counterparty: string;
      description: string;
      postings: PostingInput[];
    }) =>
      api<Transaction>("/api/v1/transactions", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: transactionKeys.all }),
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

      queryClient.setQueriesData<TransactionsData>(
        { queryKey: transactionKeys.all },
        (data) =>
          updateTransactions(data, (transaction) => {
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
          }),
      );

      return { previous };
    },
    onError: (_error, _input, context) =>
      restoreQueries(queryClient, context?.previous ?? []),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stats"] }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: transactionKeys.all }),
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

export function useAddTransactionTagMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { ids: string[]; value: string }) =>
      api<{ tagged: number }>("/api/v1/transactions/tags", {
        method: "POST",
        body: JSON.stringify({
          transaction_ids: input.ids,
          tag: input.value,
        }),
      }),
    onMutate: async (input) => {
      const previous = await snapshotTransactions(queryClient);
      const ids = new Set(input.ids);
      queryClient.setQueriesData<TransactionsData>(
        { queryKey: transactionKeys.all },
        (data) =>
          updateTransactions(data, (transaction) =>
            ids.has(transaction.id) && !transaction.tags.includes(input.value)
              ? {
                  ...transaction,
                  tags: [...transaction.tags, input.value].sort(),
                }
              : transaction,
          ),
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
        body: JSON.stringify({
          transaction_ids: input.ids,
          tag: input.value,
        }),
      }),
    onMutate: async (input) => {
      const previous = await snapshotTransactions(queryClient);
      const ids = new Set(input.ids);
      queryClient.setQueriesData<TransactionsData>(
        { queryKey: transactionKeys.all },
        (data) =>
          updateTransactions(data, (transaction) =>
            ids.has(transaction.id) && transaction.tags.includes(input.value)
              ? {
                  ...transaction,
                  tags: transaction.tags.filter((tag) => tag !== input.value),
                }
              : transaction,
          ),
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
      queryClient.setQueriesData<TransactionsData>(
        { queryKey: transactionKeys.all },
        (data) =>
          updateTransactions(data, (transaction) =>
            removed.has(transaction.id) ? null : transaction,
          ),
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
}
