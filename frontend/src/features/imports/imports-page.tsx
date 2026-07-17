import { Field as FormField, Form, useForm } from "@formisch/react";
import { useEffect, useRef } from "react";
import * as v from "valibot";
import { Link } from "wouter";

import { useBucketsQuery } from "../../api/buckets";
import { useCurrenciesQuery } from "../../api/currencies";
import {
  useCreateImportMutation,
  useInfiniteImportsQuery,
} from "../../api/imports";
import { useMeQuery } from "../../api/user";
import { Button } from "../../ui/button/button";
import { Field, InputGroup } from "../../ui/input/input";
import { BucketPicker } from "../buckets/bucket-picker";
import { TransactionForm } from "../transactions/new-transaction-page";

import inputStyles from "../../ui/input/input.module.css";
import styles from "./imports.module.css";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const schema = v.object({
  file: v.instance(File, "Choose a file"),
  bucket: v.pipe(v.string(), v.nonEmpty("Select an account")),
  format: v.string(),
  timezone: v.pipe(v.string(), v.nonEmpty("Select a timezone")),
});

const detectedTimezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
const timezones = [
  detectedTimezone,
  ...Intl.supportedValuesOf("timeZone").filter((tz) => tz !== detectedTimezone),
];

export default function ImportsPage() {
  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.title}>Import transactions</h1>
        <div className={styles.card}>
          <ImportForm />
        </div>
      </div>

      <section>
        <h1 className={styles.title}>Past imports</h1>
        <PastImports />
      </section>

      <section>
        <h1 className={styles.title}>Import manually</h1>
        <ManualImport />
      </section>
    </div>
  );
}

function ImportForm() {
  const buckets = useBucketsQuery();
  const mutation = useCreateImportMutation();

  const form = useForm({
    schema,
    initialInput: { format: "nordea", timezone: detectedTimezone },
  });

  const onSubmit = async (values: v.InferOutput<typeof schema>) => {
    if (mutation.isPending) return;
    try {
      await mutation.mutateAsync({
        file: values.file,
        bucketId: values.bucket,
        format: values.format,
        timezone: values.timezone,
      });
    } catch {
      // surfaced via mutation.isError below
    }
  };

  return (
    <Form of={form} className={styles.form} onSubmit={onSubmit}>
      <FormField of={form} path={["file"]}>
        {(field) => (
          <Field
            className={inputStyles.horizontal}
            label="File"
            error={field.errors?.[0]}
          >
            <input
              {...field.props}
              className={inputStyles.control}
              type="file"
              accept=".csv,text/csv"
            />
          </Field>
        )}
      </FormField>

      <FormField of={form} path={["bucket"]}>
        {(field) => (
          <Field
            className={inputStyles.horizontal}
            label="Account"
            error={field.errors?.[0]}
            as="div"
          >
            <BucketPicker
              kinds={["asset", "liability"]}
              createKinds={["asset"]}
              placeholder="Select account"
              value={buckets.data?.find((b) => b.id === field.input) ?? null}
              onPick={(bucket) => field.onChange(bucket.id)}
            />
          </Field>
        )}
      </FormField>

      <FormField of={form} path={["format"]}>
        {(formatField) => (
          <>
            <Field className={inputStyles.horizontal} label="Format">
              <InputGroup>
                <select {...formatField.props} className={styles.select}>
                  <option value="nordea">Nordea</option>
                  <option value="op">OP</option>
                  <option value="revolut">Revolut</option>
                </select>
              </InputGroup>
            </Field>

            {formatField.input !== "revolut" && (
              <FormField of={form} path={["timezone"]}>
                {(field) => (
                  <Field
                    className={inputStyles.horizontal}
                    label="Dates in timezone"
                    error={field.errors?.[0]}
                  >
                    <InputGroup>
                      <select {...field.props} className={styles.select}>
                        {timezones.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                    </InputGroup>
                  </Field>
                )}
              </FormField>
            )}
          </>
        )}
      </FormField>

      {mutation.isError && (
        <p className={styles.error}>{mutation.error.message}</p>
      )}

      <div className={styles.buttonRow}>
        <Button type="submit" className={styles.submit}>
          {form.isSubmitting ? "Importing…" : "Import"}
        </Button>
        <Button type="reset" variant="ghost">
          Reset
        </Button>
      </div>
    </Form>
  );
}

const skeletonRows = [
  { name: "13rem", meta: "16rem" },
  { name: "9rem", meta: "20rem" },
  { name: "11rem", meta: "14rem" },
];

function PastImportsSkeleton() {
  return (
    <ul className={styles.list} aria-hidden="true">
      {skeletonRows.map((row, i) => (
        <li key={i} className={styles.skeletonBatch}>
          <span
            className={styles.skeletonBar}
            style={{ inlineSize: row.name }}
          />
          <span
            className={`${styles.skeletonBar} ${styles.skeletonMeta}`}
            style={{ inlineSize: row.meta }}
          />
        </li>
      ))}
    </ul>
  );
}

function PastImports() {
  const imports = useInfiniteImportsQuery();
  const buckets = useBucketsQuery();
  const batches = imports.data?.pages.flatMap((page) => page.rows) ?? [];

  const bucketName = (id: string) =>
    buckets.data?.find((b) => b.id === id)?.name ?? id;

  if (imports.isPending || buckets.isPending) return <PastImportsSkeleton />;
  if (imports.isError) return <p>error: {imports.error.message}</p>;
  if (!batches.length) return <p>no imports yet</p>;

  return (
    <div className={styles.listScroller}>
      <ul className={styles.list}>
        {batches.map((batch) => {
          const processing =
            batch.status === "uploaded" || batch.status === "processing";
          return (
            <li
              key={batch.id}
              className={`${styles.batch}${processing ? ` ${styles.processing}` : ""}`}
            >
              <Link href={`/imports/${batch.id}`} className={styles.batchLink}>
                {batch.filename}
              </Link>
              <span className={styles.filename}>{batch.filename}</span>
              <span className={styles.meta}>
                {bucketName(batch.bucket_id)} ·{" "}
                {dateFormat.format(new Date(batch.created_at))}
              </span>
              <span className={styles.status}>
                {batch.status === "done"
                  ? `${batch.imported} imported · ${batch.duplicates} duplicates`
                  : batch.status === "failed"
                    ? "Failed"
                    : "Processing… refresh for updates"}
              </span>
            </li>
          );
        })}
      </ul>
      <LoadMore imports={imports} />
    </div>
  );
}

function LoadMore(props: {
  imports: ReturnType<typeof useInfiniteImportsQuery>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !props.imports.hasNextPage) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !props.imports.isFetchingNextPage) {
        void props.imports.fetchNextPage();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.imports]);

  if (!props.imports.hasNextPage) return null;
  return (
    <div ref={ref} className={styles.loadMore}>
      {props.imports.isFetchingNextPage ? "Loading…" : "Load more"}
    </div>
  );
}

function ManualImport() {
  const currencies = useCurrenciesQuery();
  const me = useMeQuery();

  if (currencies.isError || me.isError) {
    return <p>error: {(currencies.error ?? me.error)?.message}</p>;
  }
  if (!currencies.data || !me.data) return <p>loading…</p>;

  return <TransactionForm homeCurrency={me.data.home_currency} />;
}
