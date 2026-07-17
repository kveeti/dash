import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api } from "./api";
import type { BucketKind } from "./buckets";

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

interface TransactionsPage {
  transactions: Transaction[];
  next_cursor: Cursor | null;
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
      if (props.searchQuery)
        params.set("q", encodeURIComponent(props.searchQuery));
      if (props.tag) params.set("tag", encodeURIComponent(props.tag));

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
    mutationFn: (input: { ids: string[]; bucketId: string }) =>
      api<{ categorized: number }>("/api/v1/transactions/categorize", {
        method: "POST",
        body: JSON.stringify({
          transaction_ids: input.ids,
          bucket_id: input.bucketId,
        }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: transactionKeys.all }),
  });
}

export function useTagsQuery(searchQuery = "") {
  return useQuery({
    queryKey: [...tagKeys.all, searchQuery],
    queryFn: () =>
      api<{ tags: string[] }>(
        `/api/v1/tags${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ""}`,
      ),
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
    onSuccess: () => {
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
    onSuccess: () => {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
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
