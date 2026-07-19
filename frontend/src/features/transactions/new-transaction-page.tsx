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
import { FieldInvalidContext } from "../../ui/input/field-context";
import { Field, Input, InputGroup, Select } from "../../ui/input/input";
import { BucketPicker } from "../buckets/bucket-picker";

const tab =
  "cursor-pointer rounded-full border-0 bg-transparent px-3 py-1 text-gray-700";
const activeTab =
  "cursor-pointer rounded-full border-0 bg-gray-0 px-3 py-1 font-semibold text-gray-900 shadow-[0_1px_3px_rgb(0_0_0_/_0.1)]";

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
    <div className="mx-auto w-full max-w-(--page-width) px-3 pt-6 sm:px-6">
      <h1 className="text-title font-medium">New transaction</h1>
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

export function TransactionForm(props: {
  homeCurrency: string;
  showCategoryKindSelector?: boolean;
  className?: string;
}) {
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
    const selectedCategory = bucketById(values.category);
    const transactionMode =
      props.showCategoryKindSelector === false
        ? selectedCategory?.kind === "income"
          ? "income"
          : "expense"
        : mode;
    const accountAmount = transactionMode === "expense" ? -amount : amount;
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
    <div className="-mx-3 rounded-2xl border border-border-subtle p-6 sm:-mx-6 bg-form">
      <Form
        of={form}
        className="flex w-full flex-col gap-3 min-[30rem]:grid min-[30rem]:grid-cols-[auto_minmax(0,22rem)] min-[30rem]:items-center min-[30rem]:gap-x-8 min-[30rem]:gap-y-3 min-[30rem]:[&>*]:col-span-full"
        onSubmit={onSubmit}
      >
        <FormField of={form} path={["date"]}>
          {(field) => (
            <Field label="Date" error={field.errors?.[0]}>
              <Input {...field.props} type="date" value={field.input ?? ""} />
            </Field>
          )}
        </FormField>

        <FormField of={form} path={["counterparty"]}>
          {(field) => (
            <Field label="Counterparty" error={field.errors?.[0]}>
              <Input {...field.props} type="text" value={field.input ?? ""} />
            </Field>
          )}
        </FormField>

        <FormField of={form} path={["description"]}>
          {(field) => (
            <Field label="Description" error={field.errors?.[0]}>
              <Input {...field.props} type="text" value={field.input ?? ""} />
            </Field>
          )}
        </FormField>

        <FormField of={form} path={["amount"]}>
          {(amount) => (
            <Field label="Amount" error={amount.errors?.[0]}>
              <InputGroup invalid={false}>
                <Input
                  {...amount.props}
                  grouped
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount.input ?? ""}
                />
                <FormField of={form} path={["currency"]}>
                  {(currency) => (
                    <FieldInvalidContext.Provider
                      value={Boolean(currency.errors?.[0])}
                    >
                      <Select
                        {...currency.props}
                        grouped
                        aria-label="Currency"
                        value={currency.input ?? ""}
                      >
                        {currencyOptions().map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </Select>
                    </FieldInvalidContext.Provider>
                  )}
                </FormField>
              </InputGroup>
            </Field>
          )}
        </FormField>

        <FormField of={form} path={["account"]}>
          {(field) => (
            <Field label="Account" error={field.errors?.[0]} as="div">
              <div className="w-full">
                <BucketPicker
                  kinds={["asset"]}
                  createKinds={["asset"]}
                  value={bucketById(field.input ?? "")}
                  onPick={(bucket) => field.onChange(bucket.id)}
                  placeholder="Select account"
                />
              </div>
            </Field>
          )}
        </FormField>

        <FormField of={form} path={["category"]}>
          {(field) => (
            <Field label="Category" error={field.errors?.[0]} as="div">
              <div className="flex flex-col">
                {props.showCategoryKindSelector !== false && (
                  <div className="mb-2 inline-flex items-center self-start rounded-full bg-gray-100 p-1 text-sm">
                    <button
                      type="button"
                      className={mode === "expense" ? activeTab : tab}
                      onClick={() => switchMode("expense")}
                    >
                      Expense
                    </button>
                    <button
                      type="button"
                      className={mode === "income" ? activeTab : tab}
                      onClick={() => switchMode("income")}
                    >
                      Income
                    </button>
                  </div>
                )}
                <BucketPicker
                  kinds={
                    props.showCategoryKindSelector === false
                      ? ["expense", "income"]
                      : [mode]
                  }
                  createKinds={
                    props.showCategoryKindSelector === false
                      ? ["expense", "income"]
                      : [mode]
                  }
                  value={bucketById(field.input ?? "")}
                  onPick={(bucket) => field.onChange(bucket.id)}
                  placeholder="Select category"
                />
              </div>
            </Field>
          )}
        </FormField>

        {mutation.isError && <p>error: {mutation.error?.message}</p>}

        <div className="flex flex-row-reverse gap-4">
          <Button type="submit" className="w-full">
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
