import { infiniteQueryOptions, keepPreviousData } from "@tanstack/solid-query";

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

export const transactionsQuery = (q: string) =>
  infiniteQueryOptions({
    queryKey: ["transactions", "list", q],
    queryFn: ({ pageParam }: { pageParam: Cursor | null }) =>
      transactionsPage(pageParam, q ? `q=${encodeURIComponent(q)}` : ""),
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

export function deleteTransaction(id: string): Promise<void> {
  return api<void>(`/api/v1/transactions/${id}`, {
    method: "DELETE",
  });
}
