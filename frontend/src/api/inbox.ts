import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useQueryClient,
} from "@tanstack/solid-query";

import { api } from "./http";
import { transactionKeys } from "./transactions";

export const inboxKeys = {
  all: ["inbox"] as const,
};

export interface InboxRow {
  id: string;
  date: string;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
  account: string;
}

export interface InboxMatch extends InboxRow {
  kind: "transfer" | "exchange";
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
    queryKey: [...inboxKeys.all, q],
    queryFn: ({ pageParam }: { pageParam: Cursor | null }) =>
      inboxPage(pageParam, q),
    initialPageParam: null as Cursor | null,
    getNextPageParam: (last: InboxPage) => last.next_cursor,
    placeholderData: keepPreviousData,
  });

export const inboxMatchesQuery = (id: string, q: string) =>
  queryOptions({
    queryKey: ["inbox-matches", id, q],
    queryFn: () =>
      api<{ source: InboxRow; matches: InboxMatch[] }>(
        `/api/v1/inbox/${id}/matches${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      ),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === id ? previous : undefined,
  });

export function matchInboxRowsMutation() {
  const queryClient = useQueryClient();
  return {
    mutationFn: ({ id, matchId }: { id: string; matchId: string }) =>
      matchInboxRows(id, matchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.all });
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
    },
  };
}

export function matchInboxRows(id: string, matchId: string) {
  return api<{ matched: boolean }>(`/api/v1/inbox/${id}/match`, {
    method: "POST",
    body: JSON.stringify({ match_id: matchId }),
  });
}

export function categorizeInboxMutation() {
  const queryClient = useQueryClient();
  return {
    mutationFn: ({ ids, bucketId }: { ids: string[]; bucketId: string }) =>
      categorizeInbox(ids, bucketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.all });
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
    },
  };
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
