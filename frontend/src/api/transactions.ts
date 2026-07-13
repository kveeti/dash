import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
} from "@tanstack/solid-query";

import { api } from "./http";

export interface Posting {
  id: string;
  bucket_id: string;
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

const transactionsPage = (pageParam: Cursor | null, extra = "") => {
  const cursor = pageParam
    ? `before_date=${pageParam.date}&before_id=${pageParam.id}`
    : "";
  const query = [cursor, extra].filter(Boolean).join("&");
  return api<TransactionsPage>(
    `/api/v1/transactions${query ? `?${query}` : ""}`,
  );
};

export const transactionsQuery = (q: string, tag: string) =>
  infiniteQueryOptions({
    queryKey: ["transactions", "list", q, tag],
    queryFn: ({ pageParam }: { pageParam: Cursor | null }) =>
      transactionsPage(
        pageParam,
        [
          q ? `q=${encodeURIComponent(q)}` : "",
          tag ? `tag=${encodeURIComponent(tag)}` : "",
        ]
          .filter(Boolean)
          .join("&"),
      ),
    initialPageParam: null as Cursor | null,
    getNextPageParam: (last: TransactionsPage) => last.next_cursor,
    placeholderData: keepPreviousData,
  });

export interface PostingInput {
  bucket_id: string;
  amount: number;
  currency: string;
}

export function createTransaction(input: {
  date: string;
  counterparty: string;
  description: string;
  postings: PostingInput[];
}): Promise<Transaction> {
  return api<Transaction>("/api/v1/transactions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function bulkCategorize(
  transactionIds: string[],
  bucketId: string,
): Promise<{ categorized: number }> {
  return api<{ categorized: number }>("/api/v1/transactions/categorize", {
    method: "POST",
    body: JSON.stringify({
      transaction_ids: transactionIds,
      bucket_id: bucketId,
    }),
  });
}

export const tagsQuery = (q = "") =>
  queryOptions({
    queryKey: ["tags", q],
    queryFn: () =>
      api<{ tags: string[] }>(
        `/api/v1/tags${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      ),
  });

export function addTransactionTag(transactionIds: string[], tag: string) {
  return api<{ tagged: number }>("/api/v1/transactions/tags", {
    method: "POST",
    body: JSON.stringify({ transaction_ids: transactionIds, tag }),
  });
}

export function removeTransactionTag(transactionIds: string[], tag: string) {
  return api<{ untagged: number }>("/api/v1/transactions/tags", {
    method: "DELETE",
    body: JSON.stringify({ transaction_ids: transactionIds, tag }),
  });
}

export function deleteTransaction(id: string): Promise<void> {
  return api<void>(`/api/v1/transactions/${id}`, {
    method: "DELETE",
  });
}
