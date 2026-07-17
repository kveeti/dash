import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";

import { api } from "./api";
import { bucketKeys, type Bucket } from "./buckets";
import { restoreQueries, type QuerySnapshot } from "./query-snapshot";

export const inboxKeys = {
  all: ["inbox"] as const,
  list: ({ searchQuery }: { searchQuery: string | null }) => [
    "inbox",
    searchQuery,
  ],
};

export interface InboxItem {
  id: string;
  date: string;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
  account: string;
}

export interface InboxMatch extends InboxItem {
  kind: "transfer" | "exchange";
}

export interface InboxPage {
  rows: InboxItem[];
  next_cursor: { date: string; id: string } | null;
}

export type InboxCacheSnapshot = QuerySnapshot<InfiniteData<InboxPage>>;

export function restoreInboxRows(rowIds: string[]) {
  return api<{ restored: number }>("/api/v1/inbox/restore", {
    method: "POST",
    body: JSON.stringify({ row_ids: rowIds }),
  });
}

export function useInfiniteInboxQuery(props: { searchQuery: string | null }) {
  return useInfiniteQuery({
    queryKey: inboxKeys.list({ searchQuery: props.searchQuery }),
    queryFn: async ({ pageParam }: { pageParam: InboxPage["next_cursor"] }) => {
      const params = new URLSearchParams();
      if (pageParam) {
        params.set("before_date", pageParam.date);
        params.set("before_id", pageParam.id);
      }

      if (props.searchQuery) {
        params.set("q", encodeURIComponent(props.searchQuery));
      }

      return api<InboxPage>(
        `/api/v1/inbox${params.size ? `?${params.toString()}` : ""}`,
      );
    },
    initialPageParam: null,
    getNextPageParam: (last: InboxPage) => last.next_cursor,
    placeholderData: keepPreviousData,
  });
}

export type InboxCategoryTarget =
  | { type: "bucket"; bucketId: string }
  | {
      type: "new-bucket";
      kind: "expense" | "income" | "person";
      name: string;
    };

export function useCategorizeInboxMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { rowIds: string[]; target: InboxCategoryTarget }) =>
      api<{
        categorized: number;
        bucket?: Bucket;
      }>("/api/v1/inbox/categorize", {
        method: "POST",
        body: JSON.stringify({
          row_ids: input.rowIds,
          ...(input.target.type === "bucket"
            ? { bucket_id: input.target.bucketId }
            : {
                bucket: {
                  kind: input.target.kind,
                  name: input.target.name,
                },
              }),
        }),
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.all });
      const previous = queryClient.getQueriesData<InfiniteData<InboxPage>>({
        queryKey: inboxKeys.all,
      });

      queryClient.setQueriesData<InfiniteData<InboxPage>>(
        { queryKey: inboxKeys.all },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              rows: page.rows.filter((row) => !input.rowIds.includes(row.id)),
            })),
          },
      );

      return { previous };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      const bucket = result.bucket;
      if (bucket) {
        queryClient.setQueryData<Bucket[]>(bucketKeys.all, (current = []) => [
          ...current,
          bucket,
        ]);
      }
    },
    onError: (_error, _input, context) =>
      restoreQueries(queryClient, context?.previous ?? []),
    onSettled: () => queryClient.invalidateQueries({ queryKey: inboxKeys.all }),
  });
}

export function useMatchInboxMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; matchId: string }) =>
      api<{ matched: true }>(`/api/v1/inbox/${input.id}/match`, {
        method: "POST",
        body: JSON.stringify({ match_id: input.matchId }),
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.all });
      const previous = queryClient.getQueriesData<InfiniteData<InboxPage>>({
        queryKey: inboxKeys.all,
      });

      queryClient.setQueriesData<InfiniteData<InboxPage>>(
        { queryKey: inboxKeys.all },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              rows: page.rows.filter(
                (row) => row.id !== input.id && row.id !== input.matchId,
              ),
            })),
          },
      );

      return { previous };
    },
    onError: (_error, _input, context) =>
      restoreQueries(queryClient, context?.previous ?? []),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: inboxKeys.all }),
  });
}

export function useInboxMatchesQuery(props: {
  id: string;
  searchQuery: string;
}) {
  return useQuery({
    enabled: Boolean(props.id),
    queryKey: ["inbox-matches", props.id, props.searchQuery],
    queryFn: () => {
      const params = new URLSearchParams();

      if (props.searchQuery) {
        params.set("q", encodeURIComponent(props.searchQuery));
      }

      return api<{ source: InboxItem; matches: InboxMatch[] }>(
        `/api/v1/inbox/${props.id}/matches${params.size ? `?${params.toString()}` : ""}`,
      );
    },
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === props.id ? previous : undefined,
  });
}
