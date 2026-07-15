import {
  createForm,
  Field as FormField,
  Form,
  setErrors,
  setInput,
} from "@formisch/solid";
import { useNavigate } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import * as v from "valibot";

import { bucketsQuery, createBucket, type BucketKind } from "../../api/buckets";
import { currenciesQuery } from "../../api/currencies";
import { createTransaction } from "../../api/transactions";
import { meQuery } from "../../api/user";
import { Button } from "../../ui/button/button";
import { Field, Input, InputGroup } from "../../ui/input/input";
import { BucketCombobox } from "./bucket-combobox";

import inputStyles from "../../ui/input/input.module.css";
import styles from "./new-transaction-page.module.css";

const today = () => new Date().toISOString().slice(0, 10);

const schema = v.object({
  date: v.pipe(v.string(), v.nonEmpty("Pick a date")),
  counterparty: v.pipe(v.string(), v.nonEmpty("Enter a counterparty")),
  description: v.string(),
  amount: v.pipe(
    v.string(),
    v.nonEmpty("Enter an amount"),
    v.regex(/^\d+(\.\d+)?$/, "Enter a valid amount"),
  ),
  currency: v.pipe(
    v.string(),
    v.length(3, "Use a 3-letter code"),
    v.transform((s) => s.toUpperCase()),
  ),
  account: v.pipe(v.string(), v.nonEmpty("Select an account")),
  category: v.pipe(v.string(), v.nonEmpty("Select a category")),
});

export default function NewTransactionPage() {
  const buckets = useQuery(bucketsQuery);
  const currencies = useQuery(currenciesQuery);
  const me = useQuery(meQuery);

  return (
    <div class={styles.page}>
      <h1 style={{ "font-size": "1.2rem", "font-weight": "500" }}>
        New transaction
      </h1>
      <Show
        when={buckets.data && currencies.data && me.data}
        fallback={<p>loading…</p>}
      >
        <TransactionForm />
      </Show>
    </div>
  );
}

function TransactionForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const buckets = useQuery(bucketsQuery);
  const currencies = useQuery(currenciesQuery);
  const me = useQuery(meQuery);

  const [mode, setMode] = createSignal<"expense" | "income">("expense");

  const form = createForm({
    schema,
    initialInput: {
      date: today(),
      currency: me.data!.home_currency,
    },
  });

  const switchMode = (next: "expense" | "income") => {
    setMode(next);
    setInput(form, { path: ["category"], input: "" });
  };

  const assets = () => buckets.data?.filter((b) => b.kind === "asset") ?? [];
  const categories = () => buckets.data?.filter((b) => b.kind === mode()) ?? [];

  const currencyOptions = () => {
    const home = me.data!.home_currency;
    return [
      home,
      ...currencies
        .data!.map((currency) => currency.code)
        .filter((code) => code !== home),
    ];
  };

  const onCreate = (kind: BucketKind) => async (name: string) => {
    const bucket = await createBucket({ kind, name });
    await queryClient.invalidateQueries({ queryKey: ["buckets"] });
    return bucket;
  };

  const mutation = useMutation(() => ({
    mutationFn: createTransaction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      navigate("/transactions");
    },
  }));

  const onSubmit = async (values: v.InferOutput<typeof schema>) => {
    const exponent = currencies.data!.find(
      (currency) => currency.code === values.currency,
    )!.exponent;
    const [whole, fraction = ""] = values.amount.split(".");
    if (fraction.length > exponent) {
      setErrors(form, {
        path: ["amount"],
        errors: [
          exponent === 0
            ? `${values.currency} does not use decimal places`
            : `Use at most ${exponent} decimal places`,
        ],
      });
      return;
    }
    const amount = Number(whole + fraction.padEnd(exponent, "0"));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setErrors(form, {
        path: ["amount"],
        errors: ["Enter an amount greater than zero"],
      });
      return;
    }
    setErrors(form, { path: ["amount"], errors: null });
    const accountAmount = mode() === "expense" ? -amount : amount;
    try {
      await mutation.mutateAsync({
        date: new Date(values.date + "T00:00:00").toISOString(),
        counterparty: values.counterparty,
        description: values.description,
        postings: [
          {
            bucket_id: values.account,
            amount: accountAmount,
            currency: values.currency,
          },
          {
            bucket_id: values.category,
            amount: -accountAmount,
            currency: values.currency,
          },
        ],
      });
    } catch {
      // surfaced via mutation.isError below
    }
  };

  return (
    <div class={styles.card}>
      <Form of={form} class={styles.form} onSubmit={onSubmit}>
        <FormField of={form} path={["date"]}>
          {(field) => (
            <Input
              {...field.props}
              class={inputStyles.horizontal}
              label="Date"
              type="date"
              value={field.input ?? ""}
              error={field.errors?.[0]}
            />
          )}
        </FormField>

        <FormField of={form} path={["counterparty"]}>
          {(field) => (
            <Input
              {...field.props}
              class={inputStyles.horizontal}
              label="Counterparty"
              type="text"
              value={field.input ?? ""}
              error={field.errors?.[0]}
            />
          )}
        </FormField>

        <FormField of={form} path={["description"]}>
          {(field) => (
            <Input
              {...field.props}
              class={inputStyles.horizontal}
              label="Description"
              type="text"
              value={field.input ?? ""}
              error={field.errors?.[0]}
            />
          )}
        </FormField>

        <FormField of={form} path={["amount"]}>
          {(amount) => (
            <Field
              class={inputStyles.horizontal}
              label="Amount"
              error={amount.errors?.[0]}
            >
              <InputGroup>
                <input
                  {...amount.props}
                  class={amount.errors?.[0] ? inputStyles.invalid : undefined}
                  type="text"
                  inputmode="decimal"
                  placeholder="0.00"
                  value={amount.input ?? ""}
                />
                <FormField of={form} path={["currency"]}>
                  {(currency) => (
                    <select
                      {...currency.props}
                      aria-label="Currency"
                      value={currency.input ?? ""}
                    >
                      <For each={currencyOptions()}>
                        {(code) => <option value={code}>{code}</option>}
                      </For>
                    </select>
                  )}
                </FormField>
              </InputGroup>
            </Field>
          )}
        </FormField>

        <FormField of={form} path={["account"]}>
          {(field) => (
            <BucketCombobox
              class={inputStyles.horizontal}
              label="Account"
              buckets={assets()}
              value={field.input ?? null}
              onChange={(id) => field.onInput(id)}
              onCreate={onCreate("asset")}
              placeholder="Select account"
              searchPlaceholder="Filter accounts..."
              error={field.errors?.[0]}
            />
          )}
        </FormField>

        <FormField of={form} path={["category"]}>
          {(field) => (
            <BucketCombobox
              class={inputStyles.horizontal}
              label="Category"
              buckets={categories()}
              value={field.input ?? null}
              onChange={(id) => field.onInput(id)}
              onCreate={onCreate(mode())}
              placeholder="Select category"
              searchPlaceholder="Filter categories..."
              error={field.errors?.[0]}
            />
          )}
        </FormField>

        <Show when={mutation.isError}>
          <p>error: {mutation.error?.message}</p>
        </Show>

        <div
          style={{
            display: "flex",
            "flex-direction": "row-reverse",
            gap: "1rem",
          }}
        >
          <Button
            type="submit"
            disabled={form.isSubmitting}
            style={{ width: "100%" }}
          >
            Save
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
    </div>
  );
}
