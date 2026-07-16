import { useQuery } from "@tanstack/react-query";

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
