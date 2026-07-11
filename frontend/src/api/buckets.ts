import { queryOptions } from "@tanstack/solid-query";

import { api } from "./http";

export type BucketKind =
  | "asset"
  | "liability"
  | "expense"
  | "income"
  | "person";

export interface Bucket {
  id: string;
  kind: BucketKind;
  name: string;
  parent_id: string | null;
  hidden: boolean;
}

export const bucketsQuery = () =>
  queryOptions({
    queryKey: ["buckets"],
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
