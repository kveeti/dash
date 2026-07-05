import { infiniteQueryOptions } from "@tanstack/solid-query";

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

export const transactionsQuery = () =>
  infiniteQueryOptions({
    queryKey: ["transactions"],
    queryFn: ({ pageParam }: { pageParam: Cursor | null }) => {
      const query = pageParam
        ? `?before_date=${pageParam.date}&before_id=${pageParam.id}`
        : "";
      return api<TransactionsPage>(`/api/v1/transactions${query}`);
    },
    initialPageParam: null as Cursor | null,
    getNextPageParam: (last: TransactionsPage) => last.next_cursor,
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

export function deleteTransaction(id: string): Promise<void> {
  return api<void>(`/api/v1/transactions/${id}`, {
    method: "DELETE",
  });
}
