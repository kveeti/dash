import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

export type BucketKind =
  | "asset"
  | "liability"
  | "expense"
  | "income"
  | "person"
  | "clearing";

export interface Bucket {
  id: string;
  kind: BucketKind;
  name: string;
  hidden: boolean;
  parent_id: string | null;
}

export const bucketKeys = {
  all: ["buckets"] as const,
};

export function useBucketsQuery() {
  return useQuery({
    queryKey: bucketKeys.all,
    queryFn: () => api<Bucket[]>("/api/v1/buckets"),
  });
}

export function useCreateBucketMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { kind: BucketKind; name: string }) =>
      api<Bucket>("/api/v1/buckets", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (bucket) => {
      queryClient.setQueryData<Bucket[]>(bucketKeys.all, (current = []) => [
        ...current,
        bucket,
      ]);
    },
  });
}
