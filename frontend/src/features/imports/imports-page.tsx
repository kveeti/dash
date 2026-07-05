import { createForm, Field as FormField, Form } from "@formisch/solid";
import { A, useNavigate } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Match, Show, Switch } from "solid-js";
import * as v from "valibot";

import { bucketsQuery, createBucket } from "../../api/buckets";
import { createImport, importsQuery } from "../../api/imports";
import { Button } from "../../ui/button/button";
import { Field, InputGroup } from "../../ui/input/input";
import inputStyles from "../../ui/input/input.module.css";
import { BucketCombobox } from "../transactions/bucket-combobox";

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
});

export default function ImportsPage() {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "var(--s6)" }}>
      <div>
        <h1 class={styles.title}>Import transactions</h1>
        <div class={styles.card}>
          <ImportForm />
        </div>
      </div>

      <div>
        <h1 class={styles.title}>Past imports</h1>
        <div style={{ "padding-inline": "var(--s5)" }}>
          <PastImports />
        </div>
      </div>
    </div>
  );
}

function ImportForm() {
  const buckets = useQuery(bucketsQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const form = createForm({
    schema,
    initialInput: { format: "nordea" },
  });

  const accounts = () =>
    buckets.data?.filter(
      (b) => (b.kind === "asset" || b.kind === "liability") && !b.hidden,
    ) ?? [];

  const onCreate = async (name: string) => {
    const bucket = await createBucket({ kind: "asset", name });
    await queryClient.invalidateQueries({ queryKey: ["buckets"] });
    return bucket;
  };

  const mutation = useMutation(() => ({
    mutationFn: createImport,
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["imports"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["balances"] });
      navigate(`/imports/${res.batch_id}`);
    },
  }));

  const onSubmit = async (values: v.InferOutput<typeof schema>) => {
    try {
      await mutation.mutateAsync({
        file: values.file,
        bucketId: values.bucket,
        format: values.format,
      });
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
          {(field) => (
            <Field class={inputStyles.horizontal} label="Format">
              <InputGroup>
                <select {...field.props} style={{ flex: "1" }} value={field.input ?? ""}>
                  <option value="nordea">Nordea</option>
                </select>
              </InputGroup>
            </Field>
          )}
        </FormField>

        <Show when={mutation.isError}>
          <p>error: {mutation.error?.message}</p>
        </Show>

        <div style={{ display: "flex", "flex-direction": "row-reverse", gap: "1rem" }}>
          <Button
            type="submit"
            disabled={form.isSubmitting}
            style={{ width: "100%" }}
          >
            Import
          </Button>
          <Button
            type="reset"
            variant="outline"
            disabled={form.isSubmitting}
            style={{ width: "unset" }}
          >
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
