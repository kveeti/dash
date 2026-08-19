import {
  Field as FormField,
  FieldArray,
  Form,
  getInput,
  insert,
  remove,
  setErrors,
  setInput,
  useForm,
} from "@formisch/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useRef, type RefObject } from "react";
import * as v from "valibot";

import { useBucketsQuery } from "../../api/buckets";
import { useCurrenciesQuery } from "../../api/currencies";
import { Button } from "../../ui/button/button";
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog/dialog";
import { Input } from "../../ui/input/input";
import { BucketPicker } from "../buckets/bucket-picker";
import { useI18n } from "../i18n/use-i18n";

export interface SplitAllocation {
  id?: string;
  bucketId: string;
  amount: number;
}

export interface SplitSource {
  counterparty: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  account: string;
}

interface SplitInput {
  id?: string;
  bucketId: string;
  amount: string;
}

const emptySplit = { bucketId: "", amount: "" };

export function SplitTransactionDialog(props: {
  open: boolean;
  source: SplitSource;
  allocations: SplitAllocation[];
  minimumAllocations: 1 | 2;
  error?: string;
  onClose: () => void;
  onSubmit: (allocations: SplitAllocation[]) => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const currencies = useCurrenciesQuery();
  const i18n = useI18n();
  const exponent = currencies.data?.find(
    (currency) => currency.code === props.source.currency,
  )?.exponent;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogBackdrop className="bg-black/10" />
      <DialogPopup
        ref={popupRef}
        className="start-1/2 top-1/2 max-h-[calc(100dvh-1rem)] w-[min(30rem,calc(100vw-1rem))] -translate-y-1/2 text-gray-900"
      >
        <DialogTitle className="sr-only">Split transaction</DialogTitle>
        {exponent === undefined || i18n.isLoading ? (
          <p className="p-4">Loading transaction…</p>
        ) : Math.abs(props.source.amount) < 2 ? (
          <TooSmall source={props.source} onClose={props.onClose} />
        ) : (
          <SplitForm
            {...props}
            exponent={exponent}
            portalContainer={popupRef}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function SplitForm(props: {
  source: SplitSource;
  allocations: SplitAllocation[];
  minimumAllocations: 1 | 2;
  exponent: number;
  error?: string;
  portalContainer: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSubmit: (allocations: SplitAllocation[]) => void;
}) {
  const buckets = useBucketsQuery();
  const { f } = useI18n();
  const total = Math.abs(props.source.amount);
  const form = useForm({
    schema: createSplitSchema(props.minimumAllocations),
    initialInput: {
      postings: withTrailingEmpty(
        props.allocations.map((allocation) => ({
          id: allocation.id,
          bucketId: allocation.bucketId,
          amount:
            allocation.amount > 0
              ? formatMinor(allocation.amount, props.exponent)
              : "",
        })),
      ),
    },
  });

  function addTrailingSplit(index: number) {
    const postings = getInput(form, { path: ["postings"] }) ?? [];
    if (index !== postings.length - 1 || isStarted(postings[index])) return;
    insert(form, {
      path: ["postings"],
      initialInput: emptySplit,
    });
  }

  function removeSplit(index: number) {
    const postings = getInput(form, { path: ["postings"] }) ?? [];
    if (postings.length === 1) {
      setInput(form, { path: ["postings", index], input: emptySplit });
      return;
    }
    remove(form, { path: ["postings"], at: index });
  }

  function apply(values: { postings: SplitInput[] }) {
    const postings = values.postings.filter(isStarted).map((posting) => ({
      id: posting.id,
      bucketId: posting.bucketId,
      amount: parseMinor(posting.amount, props.exponent),
    }));
    if (
      postings.some((posting) => posting.amount === null) ||
      postings.reduce((sum, posting) => sum + (posting.amount ?? 0), 0) !==
        total
    ) {
      setErrors(form, {
        errors: [
          `Split amounts must add up to ${f.amount(total, props.source.currency)}`,
        ],
      });
      return;
    }
    props.onSubmit(
      postings.map((posting) => ({
        ...(posting.id ? { id: posting.id } : {}),
        bucketId: posting.bucketId,
        amount: posting.amount!,
      })),
    );
  }

  return (
    <Form
      of={form}
      className="flex min-h-0 flex-col overflow-hidden rounded-[inherit]"
      onSubmit={apply}
    >
      <Source source={props.source} />
      <FieldArray of={form} path={["postings"]}>
        {(fieldArray) => {
          const current = getInput(form, { path: ["postings"] }) ?? [];
          const allocated = current.reduce(
            (sum, posting) =>
              sum + (parseMinor(posting?.amount ?? "", props.exponent) ?? 0),
            0,
          );
          const remaining = total - allocated;

          return (
            <>
              <div className="min-h-0 overflow-y-auto p-3">
                <div className="flex flex-col gap-3">
                  {fieldArray.items.map((item, index) => {
                    return (
                      <div
                        key={item}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 min-[24rem]:grid-cols-[minmax(0,1fr)_8.5rem_auto]"
                      >
                        <FormField
                          of={form}
                          path={["postings", index, "bucketId"]}
                        >
                          {(field) => (
                            <div className="col-span-full min-[24rem]:col-span-1">
                              <BucketPicker
                                kinds={["expense", "income", "person"]}
                                createKinds={["expense", "income", "person"]}
                                value={
                                  buckets.data?.find(
                                    (bucket) => bucket.id === field.input,
                                  ) ?? null
                                }
                                placeholder="Category or person"
                                inputPlaceholder="Filter categories..."
                                portalContainer={props.portalContainer}
                                onPick={(bucket) => {
                                  if (bucket.id) addTrailingSplit(index);
                                  field.onChange(bucket.id);
                                }}
                              />
                            </div>
                          )}
                        </FormField>
                        <FormField
                          of={form}
                          path={["postings", index, "amount"]}
                        >
                          {(field) => (
                            <Input
                              {...field.props}
                              value={field.input ?? ""}
                              inputMode="decimal"
                              placeholder="0.00"
                              aria-label={`Split ${index + 1} amount`}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                if (value) addTrailingSplit(index);
                                field.onChange(value);
                              }}
                            />
                          )}
                        </FormField>
                        <Button
                          type="button"
                          variant="ghost"
                          className="w-9 !px-2"
                          aria-label={`Remove split ${index + 1}`}
                          onClick={() => removeSplit(index)}
                        >
                          <XMarkIcon className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                  {form.errors && (
                    <p className="text-sm text-danger-fg">{form.errors[0]}</p>
                  )}
                  {props.error && (
                    <p className="text-sm text-danger-fg">{props.error}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-popover-border p-3">
                {remaining !== 0 && (
                  <p className="me-auto text-sm text-danger-fg">
                    {f.amount(Math.abs(remaining), props.source.currency)}{" "}
                    {remaining > 0 ? "remaining" : "over"}
                  </p>
                )}
                <Button type="button" variant="ghost" onClick={props.onClose}>
                  Cancel
                </Button>
                <Button type="submit">Split</Button>
              </div>
            </>
          );
        }}
      </FieldArray>
    </Form>
  );
}

function TooSmall(props: { source: SplitSource; onClose: () => void }) {
  const { f } = useI18n();
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-[inherit]">
      <Source source={props.source} />
      <p className="p-4 text-sm text-danger-fg">
        This transaction cannot be split because each split must be at least{" "}
        {f.amount(1, props.source.currency)}.
      </p>
      <div className="flex justify-end border-t border-popover-border p-3">
        <Button type="button" variant="ghost" onClick={props.onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function createSplitSchema(minimumAllocations: 1 | 2) {
  return v.pipe(
    v.object({
      postings: v.array(
        v.object({
          id: v.optional(v.string()),
          bucketId: v.string(),
          amount: v.string(),
        }),
      ),
    }),
    v.check(
      ({ postings }) => postings.filter(isStarted).length >= minimumAllocations,
      minimumAllocations === 1
        ? "Keep at least one allocation"
        : "Add at least two splits",
    ),
    v.check(
      ({ postings }) =>
        postings
          .filter(isStarted)
          .every((posting) => Boolean(posting.bucketId && posting.amount)),
      "Choose a category and enter an amount for each split",
    ),
  );
}

function Source(props: { source: SplitSource }) {
  const { f } = useI18n();
  const date = new Date(`${props.source.date}T00:00:00`);
  const dateLabel =
    date.getFullYear() === new Date().getFullYear()
      ? f.shortDate(date)
      : f.longDate(date);
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-popover-border p-3">
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium">
        {props.source.counterparty || props.source.description || "—"}
      </span>
      <span className="text-end whitespace-nowrap tabular-nums">
        {f.amount(props.source.amount, props.source.currency)}
      </span>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-base text-gray-600">
        {dateLabel}
      </span>
      <span className="text-end whitespace-nowrap text-base text-gray-600">
        {props.source.account}
      </span>
    </section>
  );
}

function withTrailingEmpty(postings: SplitInput[]) {
  return postings.length && !isStarted(postings[postings.length - 1])
    ? postings
    : [...postings, emptySplit];
}

function isStarted(posting?: { bucketId?: string; amount?: string }) {
  return Boolean(posting?.bucketId || posting?.amount);
}

function parseMinor(value: string, exponent: number) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > exponent) return null;
  const amount =
    Number(whole) * 10 ** exponent +
    Number(fraction.padEnd(exponent, "0") || "0");
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function formatMinor(value: number, exponent: number) {
  return (value / 10 ** exponent).toFixed(exponent);
}
