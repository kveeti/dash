import { infiniteQueryOptions, keepPreviousData } from "@tanstack/solid-query";

import { api } from "./http";

export interface InboxRow {
  id: string;
  date: string;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
}

interface Cursor {
  date: string;
  id: string;
}

interface InboxPage {
  rows: InboxRow[];
  next_cursor: Cursor | null;
}

const inboxPage = (pageParam: Cursor | null, q: string) => {
  const parts = [
    pageParam ? `before_date=${pageParam.date}&before_id=${pageParam.id}` : "",
    q ? `q=${encodeURIComponent(q)}` : "",
  ].filter(Boolean);
  return api<InboxPage>(
    `/api/v1/inbox${parts.length ? `?${parts.join("&")}` : ""}`,
  );
};

export const inboxQuery = (q: string) =>
  infiniteQueryOptions({
    queryKey: ["inbox", q],
    queryFn: ({ pageParam }: { pageParam: Cursor | null }) =>
      inboxPage(pageParam, q),
    initialPageParam: null as Cursor | null,
    getNextPageParam: (last: InboxPage) => last.next_cursor,
    placeholderData: keepPreviousData,
  });

export function categorizeInbox(
  rowIds: string[],
  bucketId: string,
): Promise<{ categorized: number }> {
  return api<{ categorized: number }>("/api/v1/inbox/categorize", {
    method: "POST",
    body: JSON.stringify({ row_ids: rowIds, bucket_id: bucketId }),
  });
}
