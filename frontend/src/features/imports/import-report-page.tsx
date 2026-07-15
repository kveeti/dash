import { A, useNavigate, useParams } from "@solidjs/router";
import {
  type Query,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from "@tanstack/solid-query";
import { For, Match, Show, Switch } from "solid-js";

import {
  deleteImportMutation,
  duplicatesQuery,
  forceImportRowMutation,
  importQuery,
  type ImportBatchSummary,
} from "../../api/imports";
import { formatAmount } from "../../lib/format";
import { Button } from "../../ui/button/button";

import styles from "./imports.module.css";

export default function ImportReportPage() {
  const params = useParams();
  const navigate = useNavigate();
  const batch = useQuery(() => ({
    ...importQuery(params.id),
    refetchInterval: (
      q: Query<
        ImportBatchSummary,
        Error,
        ImportBatchSummary,
        readonly ["imports", string]
      >,
    ) =>
      q.state.data?.status === "done" || q.state.data?.status === "failed"
        ? false
        : 800,
  }));

  const processing = () =>
    batch.data?.status === "uploaded" || batch.data?.status === "processing";

  const dupes = useInfiniteQuery(() => ({
    ...duplicatesQuery(params.id),
    enabled: !processing(),
  }));
  const dupeRows = () => dupes.data?.pages.flatMap((p) => p.rows) ?? [];

  const forceMutation = useMutation(() => forceImportRowMutation(params.id));
  const deleteMutation = useMutation(deleteImportMutation);

  const onUndo = () => {
    const n = batch.data?.imported ?? 0;
    if (
      window.confirm(
        `Delete this import batch and its ${n} transaction${n === 1 ? "" : "s"}?`,
      )
    )
      deleteMutation.mutate(params.id, {
        onSuccess: () => navigate("/imports"),
      });
  };

  return (
    <Switch>
      <Match when={batch.isPending}>
        <p>loading…</p>
      </Match>
      <Match when={batch.isError}>
        <p>error: {batch.error?.message}</p>
      </Match>
      <Match when={batch.data}>
        {(data) => (
          <>
            <h1 class={styles.title}>{data().filename}</h1>
            <Show
              when={processing()}
              fallback={
                <p class={styles.counts}>
                  {data().imported} imported · {data().duplicates} duplicates
                </p>
              }
            >
              <p class={styles.counts}>Processing…</p>
            </Show>

            <Show when={data().parse_errors && data().parse_errors!.length > 0}>
              <h2 class={styles.label}>Skipped rows</h2>
              <ul class={styles.list}>
                <For each={data().parse_errors}>
                  {(e) => (
                    <li class={styles.dupe}>
                      <span class={styles.dupeMain}>
                        line {e.line}: {e.error}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>

            <Show when={data().duplicates > 0}>
              <h2 class={styles.label}>Duplicates</h2>
              <ul class={styles.list}>
                <For each={dupeRows()}>
                  {(row) => (
                    <li class={styles.dupe}>
                      <span class={styles.dupeMain}>
                        {row.date} · {row.raw.payee}
                        <Show when={row.duplicate_target}>
                          {(t) => (
                            <span class={styles.target}>
                              {" "}
                              (matches {t().date} ·{" "}
                              {formatAmount(t().amount, t().currency)})
                            </span>
                          )}
                        </Show>
                      </span>
                      <span class={styles.amount}>
                        {formatAmount(row.amount, row.currency)}
                      </span>
                      <button
                        type="button"
                        disabled={forceMutation.isPending}
                        onClick={() => forceMutation.mutate(row.id)}
                      >
                        import anyway
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={dupes.hasNextPage}>
                <Button
                  type="button"
                  disabled={dupes.isFetchingNextPage}
                  onClick={() => dupes.fetchNextPage()}
                >
                  Load more
                </Button>
              </Show>
            </Show>

            <div class={styles.actions}>
              <A href="/transactions">Categorize →</A>
              <Button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={onUndo}
              >
                Undo import
              </Button>
            </div>
          </>
        )}
      </Match>
    </Switch>
  );
}
