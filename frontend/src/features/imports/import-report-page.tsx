import { useLocation, useParams } from "wouter";

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
    <div className={styles.reportPage} aria-hidden="true">
      <header className={styles.reportHeader}>
        <span
          className={`${styles.skeletonBar} ${styles.reportSkeletonTitle}`}
          style={{ display: "block", inlineSize: "12rem" }}
        />
        <span
          className={styles.skeletonBar}
          style={{ display: "block", inlineSize: "16rem" }}
        />
      </header>
      <div className={styles.reportCard}>
        <ul className={styles.reportList}>
          {["70%", "55%", "80%"].map((width, i) => (
            <li key={i} className={styles.reportRow}>
              <span
                className={styles.skeletonBar}
                style={{ inlineSize: width }}
              />
            </li>
          ))}
        </ul>
      </div>
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
    return (
      <div className={styles.reportPage}>
        <p className={styles.error}>
          error: {batch.error?.message ?? "loading currencies failed"}
        </p>
      </div>
    );

  const data = batch.data;

  return (
    <div className={styles.reportPage}>
      <header className={styles.reportHeader}>
        <h1 className={styles.reportTitle}>{data.filename}</h1>
        <p className={processing ? styles.processingSummary : undefined}>
          {processing
            ? "Processing…"
            : `${data.imported} imported · ${data.duplicates} duplicates`}
        </p>
      </header>

      {data.parse_errors && data.parse_errors.length > 0 && (
        <section className={styles.reportSection}>
          <h2 className={styles.sectionTitle}>Skipped rows</h2>
          <div className={styles.reportCard}>
            <ul className={styles.reportList}>
              {data.parse_errors.map((error, i) => (
                <li key={i} className={styles.reportRow}>
                  <span className={styles.dupeMain}>
                    Line {error.line}: {error.error}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {data.duplicates > 0 && (
        <section className={styles.reportSection}>
          <h2 className={styles.sectionTitle}>Duplicates</h2>
          <div className={styles.reportCard}>
            <ul className={styles.reportList}>
              {dupeRows.map((row) => (
                <li key={row.id} className={styles.reportRow}>
                  <span className={styles.dupeMain}>
                    <span>
                      {row.date} · {row.raw.payee}
                    </span>
                    {row.duplicate_target && (
                      <span className={styles.target}>
                        Matches {row.duplicate_target.date} ·{" "}
                        {f.amount(
                          row.duplicate_target.amount,
                          row.duplicate_target.currency,
                        )}
                      </span>
                    )}
                  </span>
                  <span className={styles.amount}>
                    {f.amount(row.amount, row.currency)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className={styles.importAnyway}
                    onClick={() => {
                      if (forceMutation.isPending) return;
                      forceMutation.mutate(row.id);
                    }}
                  >
                    import anyway
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          {forceMutation.isError && (
            <span className={styles.error}>{forceMutation.error.message}</span>
          )}
          {dupes.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              className={styles.loadDuplicates}
              onClick={() => dupes.fetchNextPage()}
            >
              {dupes.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </section>
      )}

      <div className={styles.reportActions}>
        <Button type="button" variant="destructive" onClick={onUndo}>
          {deleteMutation.isPending ? "Undoing…" : "Undo import"}
        </Button>
        {deleteMutation.isError && (
          <span className={styles.error}>{deleteMutation.error.message}</span>
        )}
      </div>
    </div>
  );
}
