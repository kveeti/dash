import { Link, useLocation, useParams } from "wouter";

import {
  useDeleteImportMutation,
  useForceImportRowMutation,
  useImportQuery,
  useInfiniteDuplicatesQuery,
} from "../../api/imports";
import { Button } from "../../ui/button/button";
import { useI18n } from "../i18n/use-i18n";

import styles from "./imports.module.css";

function ReportSkeleton() {
  return (
    <div aria-hidden="true">
      <h1 className={styles.title}>
        <span
          className={styles.skeletonBar}
          style={{ display: "block", inlineSize: "12rem" }}
        />
      </h1>
      <p className={styles.counts}>
        <span
          className={styles.skeletonBar}
          style={{ display: "block", inlineSize: "16rem" }}
        />
      </p>
      <ul className={styles.list}>
        {["18rem", "14rem", "20rem"].map((width, i) => (
          <li key={i} className={styles.dupe}>
            <span className={styles.skeletonBar} style={{ inlineSize: width }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ImportReportPage() {
  const { f, isLoading: i18nLoading, isError: i18nError } = useI18n();
  const params = useParams();
  const id = params.id!;
  const [, navigate] = useLocation();

  const batch = useImportQuery(id);
  const processing =
    batch.data?.status === "uploaded" || batch.data?.status === "processing";

  const dupes = useInfiniteDuplicatesQuery(id, !processing);
  const dupeRows = dupes.data?.pages.flatMap((p) => p.rows) ?? [];

  const forceMutation = useForceImportRowMutation(id);
  const deleteMutation = useDeleteImportMutation();

  const onUndo = () => {
    if (deleteMutation.isPending) return;
    const n = batch.data?.imported ?? 0;
    if (
      window.confirm(
        `Delete this import batch and its ${n} transaction${n === 1 ? "" : "s"}?`,
      )
    )
      deleteMutation.mutate(id, { onSuccess: () => navigate("/imports") });
  };

  if (batch.isPending || i18nLoading) return <ReportSkeleton />;
  if (batch.isError || i18nError)
    return <p>error: {batch.error?.message ?? "loading currencies failed"}</p>;

  const data = batch.data;

  return (
    <>
      <h1 className={styles.title}>{data.filename}</h1>
      <p className={styles.counts}>
        {processing
          ? "Processing…"
          : `${data.imported} imported · ${data.duplicates} duplicates`}
      </p>

      {data.parse_errors && data.parse_errors.length > 0 && (
        <>
          <h2 className={styles.label}>Skipped rows</h2>
          <ul className={styles.list}>
            {data.parse_errors.map((e, i) => (
              <li key={i} className={styles.dupe}>
                <span className={styles.dupeMain}>
                  line {e.line}: {e.error}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.duplicates > 0 && (
        <>
          <h2 className={styles.label}>Duplicates</h2>
          <ul className={styles.list}>
            {dupeRows.map((row) => (
              <li key={row.id} className={styles.dupe}>
                <span className={styles.dupeMain}>
                  {row.date} · {row.raw.payee}
                  {row.duplicate_target && (
                    <span className={styles.target}>
                      {" "}
                      (matches {row.duplicate_target.date} ·{" "}
                      {f.amount(
                        row.duplicate_target.amount,
                        row.duplicate_target.currency,
                      )}
                      )
                    </span>
                  )}
                </span>
                <span className={styles.amount}>
                  {f.amount(row.amount, row.currency)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (forceMutation.isPending) return;
                    forceMutation.mutate(row.id);
                  }}
                >
                  import anyway
                </button>
              </li>
            ))}
          </ul>
          {forceMutation.isError && (
            <span className={styles.error}>{forceMutation.error.message}</span>
          )}
          {dupes.hasNextPage && (
            <Button type="button" onClick={() => dupes.fetchNextPage()}>
              {dupes.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </>
      )}

      <div className={styles.actions}>
        <Link href="/transactions">Categorize →</Link>
        <Button type="button" onClick={onUndo}>
          {deleteMutation.isPending ? "Undoing…" : "Undo import"}
        </Button>
        {deleteMutation.isError && (
          <span className={styles.error}>{deleteMutation.error.message}</span>
        )}
      </div>
    </>
  );
}
