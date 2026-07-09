import { infiniteQueryOptions, queryOptions } from "@tanstack/solid-query";

import { api } from "./http";

export type ImportStatus = "uploaded" | "processing" | "done" | "failed";

export interface ParseError {
  line: number;
  error: string;
}

export interface ImportBatchSummary {
  id: string;
  bucket_id: string;
  filename: string;
  created_at: string;
  status: ImportStatus;
  imported: number;
  duplicates: number;
  // Only the single-batch report populates this; the list omits it.
  parse_errors?: ParseError[];
}

// The upload response: the file is stored durably and parsed/promoted in the
// background, so counts and parse errors land later via the batch report (poll
// until done).
export interface ImportResult {
  batch_id: string;
  status: ImportStatus;
}

export const importsQuery = () =>
  queryOptions({
    queryKey: ["imports"],
    queryFn: () => api<ImportBatchSummary[]>("/api/v1/imports"),
  });

// Counts-only poll payload — no rows, so the report page can poll it cheaply
// while a batch of any size promotes. Duplicate rows come from a separate
// paginated endpoint.
export const importQuery = (id: string) =>
  queryOptions({
    queryKey: ["imports", id],
    queryFn: () => api<ImportBatchSummary>(`/api/v1/imports/${id}`),
  });

export interface DuplicateTarget {
  date: string;
  amount: number;
  currency: string;
  raw_description: string;
  transaction_id: string | null;
  batch_id: string;
  created_at: string;
}

export interface DuplicateRow {
  id: string;
  date: string;
  amount: number;
  currency: string;
  raw_description: string;
  raw: Record<string, string>;
  duplicate_of: string | null;
  duplicate_target: DuplicateTarget | null;
}

interface DuplicatePage {
  rows: DuplicateRow[];
  next_cursor: string | null;
}

// Keyset-paginated duplicate rows for one batch. Cursor is the last id seen;
// next_cursor is null once the list is exhausted.
export const duplicatesQuery = (id: string) =>
  infiniteQueryOptions({
    queryKey: ["imports", id, "duplicates"],
    queryFn: ({ pageParam }) =>
      api<DuplicatePage>(
        `/api/v1/imports/${id}/duplicates?limit=50${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor,
  });

export async function createImport(input: {
  file: File;
  bucketId: string;
  format: string;
  timezone: string;
}): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("bucket_id", input.bucketId);
  form.append("format", input.format);
  form.append("timezone", input.timezone);
  return api<ImportResult>("/api/v1/imports", {
    method: "POST",
    body: form,
  });
}

export function forceImportRow(id: string): Promise<void> {
  return api<void>(`/api/v1/imports/rows/${id}/import`, { method: "POST" });
}

export function deleteImport(id: string): Promise<void> {
  return api<void>(`/api/v1/imports/${id}`, { method: "DELETE" });
}
