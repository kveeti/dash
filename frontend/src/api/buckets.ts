import { queryOptions, useQueryClient } from "@tanstack/solid-query";

import { api } from "./http";

export const bucketKeys = {
  all: ["buckets"] as const,
};

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
  parent_id: string | null;
  hidden: boolean;
}

export const bucketsQuery = () =>
  queryOptions({
    queryKey: bucketKeys.all,
    queryFn: () => api<Bucket[]>("/api/v1/buckets"),
  });

export function createBucket(input: {
  kind: BucketKind;
  name: string;
  parent_id?: string;
}): Promise<Bucket> {
  return api<Bucket>("/api/v1/buckets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function useCreateBucket() {
  const queryClient = useQueryClient();
  return async (input: {
    kind: BucketKind;
    name: string;
    parent_id?: string;
  }): Promise<Bucket> => {
    const bucket = await createBucket(input);
    await queryClient.invalidateQueries({ queryKey: bucketKeys.all });
    return bucket;
  };
}
