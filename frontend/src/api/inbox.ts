import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
} from "@tanstack/solid-query";

import { api } from "./http";

export interface InboxRow {
  id: string;
  date: string;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
  account: string;
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

export const transferMatchesQuery = (id: string, q: string) =>
  queryOptions({
    queryKey: ["inbox-transfer-matches", id, q],
    queryFn: () =>
      api<{ source: InboxRow; matches: InboxRow[] }>(
        `/api/v1/inbox/${id}/transfer-matches${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      ),
    placeholderData: keepPreviousData,
  });

export function matchInboxTransfer(id: string, matchId: string) {
  return api<{ matched: boolean }>(`/api/v1/inbox/${id}/match-transfer`, {
    method: "POST",
    body: JSON.stringify({ match_id: matchId }),
  });
}

export function categorizeInbox(
  rowIds: string[],
  bucketId: string,
): Promise<{ categorized: number }> {
  return api<{ categorized: number }>("/api/v1/inbox/categorize", {
    method: "POST",
    body: JSON.stringify({ row_ids: rowIds, bucket_id: bucketId }),
  });
}
