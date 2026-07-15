import { createForm, Field as FormField, Form } from "@formisch/solid";
import { A, useNavigate } from "@solidjs/router";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { For, Match, Show, Switch } from "solid-js";
import * as v from "valibot";

import { bucketsQuery, useCreateBucket } from "../../api/buckets";
import { createImportMutation, importsQuery } from "../../api/imports";
import { Button } from "../../ui/button/button";
import { Field, InputGroup } from "../../ui/input/input";
import { BucketCombobox } from "../transactions/bucket-combobox";

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
    <div class={styles.page}>
      <div>
        <h1 class={styles.title}>Import transactions</h1>
        <div class={styles.card}>
          <ImportForm />
        </div>
      </div>

      <div>
        <h1 class={styles.title}>Past imports</h1>
        <PastImports />
      </div>
    </div>
  );
}

function ImportForm() {
  const buckets = useQuery(bucketsQuery);
  const createBucket = useCreateBucket();
  const navigate = useNavigate();

  const form = createForm({
    schema,
    initialInput: { format: "nordea", timezone: detectedTimezone },
  });

  const accounts = () =>
    buckets.data?.filter(
      (b) => (b.kind === "asset" || b.kind === "liability") && !b.hidden,
    ) ?? [];

  const onCreate = (name: string) => createBucket({ kind: "asset", name });

  const mutation = useMutation(createImportMutation);

  const onSubmit = async (values: v.InferOutput<typeof schema>) => {
    try {
      const res = await mutation.mutateAsync({
        file: values.file,
        bucketId: values.bucket,
        format: values.format,
        timezone: values.timezone,
      });
      navigate(`/imports/${res.batch_id}`);
    } catch {
      // surfaced via mutation.isError below
    }
  };

  return (
    <Show when={buckets.data} fallback={<p>loading…</p>}>
      <Form of={form} class={styles.form} onSubmit={onSubmit}>
        <FormField of={form} path={["file"]}>
          {(field) => (
            <Field
              class={inputStyles.horizontal}
              label="File"
              error={field.errors?.[0]}
            >
              <input {...field.props} type="file" accept=".csv,text/csv" />
            </Field>
          )}
        </FormField>

        <FormField of={form} path={["bucket"]}>
          {(field) => (
            <BucketCombobox
              class={inputStyles.horizontal}
              label="Account"
              buckets={accounts()}
              value={field.input ?? null}
              onChange={(id) => field.onInput(id)}
              onCreate={onCreate}
              placeholder="Select account"
              searchPlaceholder="Filter accounts..."
              error={field.errors?.[0]}
            />
          )}
        </FormField>

        <FormField of={form} path={["format"]}>
          {(formatField) => (
            <>
              <Field class={inputStyles.horizontal} label="Format">
                <InputGroup>
                  <select
                    {...formatField.props}
                    class={styles.select}
                    value={formatField.input ?? ""}
                  >
                    <option value="nordea">Nordea</option>
                    <option value="op">OP</option>
                    <option value="revolut">Revolut</option>
                  </select>
                </InputGroup>
              </Field>

              <Show when={formatField.input !== "revolut"}>
                <FormField of={form} path={["timezone"]}>
                  {(field) => (
                    <Field
                      class={inputStyles.horizontal}
                      label="Dates in timezone"
                      error={field.errors?.[0]}
                    >
                      <InputGroup>
                        <select
                          {...field.props}
                          class={styles.select}
                          value={field.input ?? ""}
                        >
                          <For each={timezones}>
                            {(tz) => <option value={tz}>{tz}</option>}
                          </For>
                        </select>
                      </InputGroup>
                    </Field>
                  )}
                </FormField>
              </Show>
            </>
          )}
        </FormField>

        <Show when={mutation.isError}>
          <p>error: {mutation.error?.message}</p>
        </Show>

        <div class={styles.buttonRow}>
          <Button
            type="submit"
            disabled={form.isSubmitting}
            class={styles.submit}
          >
            Import
          </Button>
          <Button type="reset" variant="ghost" disabled={form.isSubmitting}>
            Reset
          </Button>
        </div>
      </Form>
    </Show>
  );
}

function PastImports() {
  const imports = useQuery(importsQuery);
  const buckets = useQuery(bucketsQuery);

  const bucketName = (id: string) =>
    buckets.data?.find((b) => b.id === id)?.name ?? id;

  return (
    <Switch>
      <Match when={imports.isPending || buckets.isPending}>
        <p>loading…</p>
      </Match>
      <Match when={imports.isError}>
        <p>error: {imports.error?.message}</p>
      </Match>
      <Match when={imports.data && buckets.data}>
        <ul class={styles.list}>
          <For each={imports.data} fallback={<p>no imports yet</p>}>
            {(batch) => (
              <li class={styles.batch}>
                <A href={`/imports/${batch.id}`}>{batch.filename}</A>
                <span class={styles.meta}>
                  {bucketName(batch.bucket_id)} ·{" "}
                  {dateFormat.format(new Date(batch.created_at))} ·{" "}
                  {batch.status === "done"
                    ? `${batch.imported} imported · ${batch.duplicates} duplicates`
                    : batch.status === "failed"
                      ? "failed"
                      : "processing…"}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Match>
    </Switch>
  );
}
