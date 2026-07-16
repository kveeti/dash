import {
  Field as FormField,
  Form,
  setErrors,
  setInput,
  useForm,
} from "@formisch/react";
import { useState } from "react";
import * as v from "valibot";
import { useLocation } from "wouter";

import { useBucketsQuery } from "../../api/buckets";
import { useCurrenciesQuery } from "../../api/currencies";
import { useCreateTransactionMutation } from "../../api/transactions";
import { useMeQuery } from "../../api/user";
import { Button } from "../../ui/button/button";
import { Field, Input, InputGroup } from "../../ui/input/input";
import { BucketPicker } from "../buckets/bucket-picker";

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
  const buckets = useBucketsQuery();
  const currencies = useCurrenciesQuery();
  const me = useMeQuery();

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>New transaction</h1>
      {buckets.isError || currencies.isError || me.isError ? (
        <p>error: {(buckets.error ?? currencies.error ?? me.error)?.message}</p>
      ) : buckets.data && currencies.data && me.data ? (
        <TransactionForm homeCurrency={me.data.home_currency} />
      ) : (
        <p>loading…</p>
      )}
    </div>
  );
}

function TransactionForm(props: { homeCurrency: string }) {
  const [, navigate] = useLocation();
  const buckets = useBucketsQuery();
  const currencies = useCurrenciesQuery();
  const mutation = useCreateTransactionMutation();

  const [mode, setMode] = useState<"expense" | "income">("expense");

  const form = useForm({
    schema,
    initialInput: {
      date: today(),
      currency: props.homeCurrency,
    },
  });

  const switchMode = (next: "expense" | "income") => {
    setMode(next);
    setInput(form, { path: ["category"], input: "" });
  };

  const bucketById = (id: string) =>
    buckets.data?.find((b) => b.id === id) ?? null;

  const currencyOptions = () => {
    const home = props.homeCurrency;
    return [
      home,
      ...currencies
        .data!.map((currency) => currency.code)
        .filter((code) => code !== home),
    ];
  };

  const onSubmit = async (values: v.InferOutput<typeof schema>) => {
    if (mutation.isPending) return;
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
    const accountAmount = mode === "expense" ? -amount : amount;
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
      navigate("/transactions");
    } catch {
      // surfaced via mutation.isError below
    }
  };

  return (
    <div className={styles.card}>
      <Form of={form} className={styles.form} onSubmit={onSubmit}>
        <FormField of={form} path={["date"]}>
          {(field) => (
            <Input
              {...field.props}
              className={inputStyles.horizontal}
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
              className={inputStyles.horizontal}
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
              className={inputStyles.horizontal}
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
              className={inputStyles.horizontal}
              label="Amount"
              error={amount.errors?.[0]}
            >
              <InputGroup>
                <input
                  {...amount.props}
                  className={
                    amount.errors?.[0] ? inputStyles.invalid : undefined
                  }
                  type="text"
                  inputMode="decimal"
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
                      {currencyOptions().map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              </InputGroup>
            </Field>
          )}
        </FormField>

        <FormField of={form} path={["account"]}>
          {(field) => (
            <Field
              className={inputStyles.horizontal}
              label="Account"
              error={field.errors?.[0]}
              as="div"
            >
              <BucketPicker
                kinds={["asset"]}
                createKinds={["asset"]}
                value={bucketById(field.input ?? "")}
                onPick={(bucket) => field.onChange(bucket.id)}
                placeholder="Select account"
              />
            </Field>
          )}
        </FormField>

        <FormField of={form} path={["category"]}>
          {(field) => (
            <Field
              className={inputStyles.horizontal}
              label="Category"
              error={field.errors?.[0]}
              as="div"
            >
              <div className={styles.modeTabs}>
                <button
                  type="button"
                  className={mode === "expense" ? styles.active : undefined}
                  onClick={() => switchMode("expense")}
                >
                  Expense
                </button>
                <button
                  type="button"
                  className={mode === "income" ? styles.active : undefined}
                  onClick={() => switchMode("income")}
                >
                  Income
                </button>
              </div>
              <BucketPicker
                kinds={[mode]}
                createKinds={[mode]}
                value={bucketById(field.input ?? "")}
                onPick={(bucket) => field.onChange(bucket.id)}
                placeholder="Select category"
              />
            </Field>
          )}
        </FormField>

        {mutation.isError && <p>error: {mutation.error?.message}</p>}

        <div className={styles.buttonRow}>
          <Button type="submit" className={styles.submit}>
            Save
          </Button>
          <Button type="reset" variant="outline">
            Reset
          </Button>
        </div>
      </Form>
    </div>
  );
}
