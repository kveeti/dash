import type { QueryClient, QueryKey } from "@tanstack/react-query";

export type QuerySnapshot<T> = [QueryKey, T | undefined][];

export function snapshotQueries<T>(
  queryClient: QueryClient,
  queries: QuerySnapshot<T>,
): QuerySnapshot<T> {
  return queries.map(([queryKey]) => [
    queryKey,
    queryClient.getQueryData<T>(queryKey),
  ]);
}

export function restoreQueries<T>(
  queryClient: QueryClient,
  snapshot: QuerySnapshot<T>,
) {
  for (const [queryKey, data] of snapshot) {
    queryClient.setQueryData(queryKey, data);
  }
}
