import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ChartBarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { useState } from "react";

import { useBucketsQuery, type Bucket } from "../../api/buckets";
import {
  useStatsQuery,
  type StatsAmount,
  type StatsComparison,
  type StatsPeriod,
  type Valuation,
} from "../../api/stats";
import { ListEmptyState } from "../../lib/list-shell/list-empty-state";
import { setSearchParams, useSearchParam } from "../../lib/search-param";
import { Input } from "../../ui/input/input";
import { useI18n } from "../i18n/use-i18n";

function dateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function periodStart(value: string, period: Exclude<StatsPeriod, "custom">) {
  const date = utcDate(value);
  if (period === "week") {
    const daysFromMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysFromMonday);
  } else if (period === "month") {
    date.setUTCDate(1);
  } else {
    date.setUTCMonth(0, 1);
  }
  return date;
}

function movePeriod(
  value: string,
  period: Exclude<StatsPeriod, "custom">,
  amount: number,
) {
  const date = periodStart(value, period);
  if (period === "week") date.setUTCDate(date.getUTCDate() + 7 * amount);
  if (period === "month") date.setUTCMonth(date.getUTCMonth() + amount);
  if (period === "year") date.setUTCFullYear(date.getUTCFullYear() + amount);
  return utcDateString(date);
}

type CategoryValue = {
  id: string;
  name: string;
  current: number;
  comparison: number;
  children: CategoryValue[];
  direct?: CategoryValue;
};

function categoryGroups(
  buckets: Bucket[],
  values: Map<string, { current: number; comparison: number }>,
  kind: "expense" | "income",
): CategoryValue[] {
  const categories = buckets.filter((bucket) => bucket.kind === kind);
  const byID = new Map(categories.map((bucket) => [bucket.id, bucket]));
  const children = new Map<string, Bucket[]>();
  for (const bucket of categories) {
    if (bucket.parent_id && byID.has(bucket.parent_id)) {
      const list = children.get(bucket.parent_id) ?? [];
      list.push(bucket);
      children.set(bucket.parent_id, list);
    }
  }

  const out: CategoryValue[] = [];
  for (const bucket of categories) {
    if (bucket.parent_id && byID.has(bucket.parent_id)) continue;
    const own = values.get(bucket.id);
    const childValues = (children.get(bucket.id) ?? [])
      .filter((child) => values.has(child.id))
      .map((child) => ({
        id: child.id,
        name: child.name,
        current: values.get(child.id)!.current,
        comparison: values.get(child.id)!.comparison,
        children: [],
      }))
      .sort((a, b) => b.current - a.current || b.comparison - a.comparison);
    if (!own && childValues.length === 0) continue;

    const direct =
      own && childValues.length > 0
        ? {
            id: bucket.id,
            name: "Other",
            current: own.current,
            comparison: own.comparison,
            children: [],
          }
        : undefined;
    out.push({
      id: bucket.id,
      name: bucket.name,
      current: childValues.reduce(
        (sum, child) => sum + child.current,
        own?.current ?? 0,
      ),
      comparison: childValues.reduce(
        (sum, child) => sum + child.comparison,
        own?.comparison ?? 0,
      ),
      children: childValues,
      direct,
    });
  }
  return out.sort(
    (a, b) => b.current - a.current || b.comparison - a.comparison,
  );
}

export default function StatsPage() {
  const {
    f,
    timeZone: timezone,
    isLoading: i18nLoading,
    isError: i18nError,
  } = useI18n();
  const today = dateString(new Date());
  const formatRange = (range: { from: string; to: string }) => {
    const from = f.longDate(utcDate(range.from));
    return range.from === range.to
      ? from
      : `${from}–${f.longDate(utcDate(range.to))}`;
  };
  const monthStart = `${today.slice(0, 7)}-01`;
  const [expanded, setExpanded] = useState(new Set<string>());

  const rawPeriod = useSearchParam("period");
  const period: StatsPeriod = ["week", "month", "year", "custom"].includes(
    rawPeriod ?? "",
  )
    ? (rawPeriod as StatsPeriod)
    : "month";
  const from = useSearchParam("from") ?? monthStart;
  const to = useSearchParam("to") ?? today;
  const anchor = useSearchParam("anchor") ?? today;
  const canCompareYear =
    period !== "year" &&
    (period !== "custom" || from.slice(0, 4) === to.slice(0, 4));
  const comparison: StatsComparison =
    useSearchParam("compare") === "year" && canCompareYear
      ? "year"
      : "previous";
  const navPeriod = period as Exclude<StatsPeriod, "custom">;

  const update = (next: Record<string, string | undefined>) => {
    setSearchParams(next, { replace: true });
  };

  const stats = useStatsQuery({
    period,
    compare: comparison,
    today,
    timezone,
    ...(period === "custom" ? { from, to } : { anchor }),
  });
  const buckets = useBucketsQuery();

  const values = new Map(
    (stats.data?.categories ?? []).map((category) => [
      category.bucket_id,
      { current: category.current, comparison: category.comparison },
    ]),
  );
  const expenses = categoryGroups(buckets.data ?? [], values, "expense");
  const income = categoryGroups(buckets.data ?? [], values, "income");
  const incomplete =
    !!stats.data &&
    (stats.data.valuation.current.unvalued_currencies.length > 0 ||
      stats.data.valuation.comparison.unvalued_currencies.length > 0);

  const setPeriod = (next: StatsPeriod) => {
    update({
      period: next,
      anchor: next === "custom" ? undefined : today,
      from: next === "custom" ? monthStart : undefined,
      to: next === "custom" ? today : undefined,
      compare: next === "year" ? "previous" : comparison,
    });
  };

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canGoNext =
    periodStart(anchor, navPeriod) < periodStart(today, navPeriod);

  return (
    <div className="mx-auto w-full max-w-(--page-width) p-3 pb-41 pwa:pb-46 sm:p-6">
      <header className="fixed inset-x-0 bottom-9 pwa:bottom-14 z-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-gray-150 bg-gray-0 px-3 py-2 sm:static sm:flex sm:flex-col sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:pb-6">
        <div
          className="col-span-full flex items-center gap-0.5 rounded-xl bg-gray-100 p-1 text-sm"
          aria-label="Stats period"
        >
          {(["week", "month", "year", "custom"] as StatsPeriod[]).map(
            (value) => (
              <button
                key={value}
                data-label={value}
                className={`inline-grid flex-1 justify-items-center rounded-[0.6rem] border-0 px-2 py-1 capitalize text-gray-700 cursor-pointer sm:px-3 after:block after:h-0 after:overflow-hidden after:font-semibold after:invisible after:content-[attr(data-label)] ${period === value ? "bg-gray-250 font-medium text-gray-900" : "hover:bg-gray-150"}`}
                onClick={() => setPeriod(value)}
              >
                {value}
              </button>
            ),
          )}
        </div>

        {period === "custom" ? (
          <div className="col-span-full grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-gray-700">
            <Input
              className="min-w-0"
              aria-label="From date"
              type="date"
              max={today}
              value={from}
              onInput={(event) => update({ from: event.currentTarget.value })}
            />
            <span>to</span>
            <Input
              className="min-w-0"
              aria-label="To date"
              type="date"
              max={today}
              value={to}
              onInput={(event) => update({ to: event.currentTarget.value })}
            />
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              className="grid size-9 place-items-center rounded-full border-0 bg-gray-100 text-gray-900 cursor-pointer hover:bg-gray-150"
              aria-label="Previous period"
              onClick={() =>
                update({ anchor: movePeriod(anchor, navPeriod, -1) })
              }
            >
              <ChevronLeftIcon className="size-4" aria-hidden="true" />
            </button>
            <button
              className={`grid size-9 place-items-center rounded-full border-0 bg-gray-100 text-gray-900 cursor-pointer hover:bg-gray-150${canGoNext ? "" : " invisible"}`}
              aria-label="Next period"
              onClick={() =>
                update({ anchor: movePeriod(anchor, navPeriod, 1) })
              }
            >
              <ChevronRightIcon className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        <div
          className={`col-start-2 flex items-center justify-self-end gap-2 text-sm${canCompareYear ? "" : " invisible"}`}
        >
          <span className="hidden text-gray-700 sm:inline">Compare with</span>
          <div className="flex items-center gap-0.5 rounded-xl bg-gray-100 p-1 text-sm">
            <button
              data-label="previous"
              className={`inline-grid justify-items-center rounded-[0.6rem] border-0 px-2 py-1 text-gray-700 cursor-pointer sm:px-3 after:block after:h-0 after:overflow-hidden after:font-semibold after:invisible after:content-[attr(data-label)] ${comparison === "previous" ? "bg-gray-250 font-medium text-gray-900" : "hover:bg-gray-150"}`}
              onClick={() => update({ compare: "previous" })}
            >
              previous
            </button>
            <button
              data-label="last year"
              className={`inline-grid justify-items-center rounded-[0.6rem] border-0 px-2 py-1 text-gray-700 cursor-pointer sm:px-3 after:block after:h-0 after:overflow-hidden after:font-semibold after:invisible after:content-[attr(data-label)] ${comparison === "year" ? "bg-gray-250 font-medium text-gray-900" : "hover:bg-gray-150"}`}
              onClick={() => update({ compare: "year" })}
            >
              last year
            </button>
          </div>
        </div>
      </header>

      {stats.isPending || buckets.isPending || i18nLoading ? (
        <StatsSkeleton />
      ) : stats.isError || buckets.isError || i18nError ? (
        <p className="text-danger-fg">
          error:{" "}
          {(stats.error ?? buckets.error)?.message ??
            "loading currencies failed"}
        </p>
      ) : (
        buckets.data &&
        stats.data && (
          <div
            className={
              stats.isPlaceholderData
                ? "opacity-50 transition-opacity delay-150 duration-200"
                : undefined
            }
          >
            <div className="mb-6">
              <h1 className="m-0 text-xl font-medium">
                {formatRange(stats.data.ranges.current)}
              </h1>
              <p className="text-sm text-gray-700">
                compared with {formatRange(stats.data.ranges.comparison)}
              </p>
            </div>

            <section
              className="mb-6 flex w-full flex-col gap-3 min-[30rem]:flex-row"
              aria-label="Summary"
            >
              <Summary
                label="Expenses"
                value={stats.data.summary.expenses}
                currency={stats.data.home_currency}
                incomplete={incomplete}
                goodWhenUp={false}
              />
              <Summary
                label="Income"
                value={stats.data.summary.income}
                currency={stats.data.home_currency}
                incomplete={incomplete}
                goodWhenUp
              />
              <Summary
                label="Net"
                value={stats.data.summary.net}
                currency={stats.data.home_currency}
                incomplete={incomplete}
                goodWhenUp
              />
            </section>

            <ValuationNotice valuation={stats.data.valuation} />

            {expenses.length === 0 && income.length === 0 && (
              <ListEmptyState
                icon={ChartBarIcon}
                heading="No transactions in this period"
                body="Choose another period, or add transactions to start tracking your spending and income."
              />
            )}

            <CategorySection
              title="Expenses"
              categories={expenses}
              currency={stats.data.home_currency}
              expanded={expanded}
              onToggle={toggle}
              incomplete={incomplete}
              goodWhenUp={false}
            />
            <CategorySection
              title="Income"
              categories={income}
              currency={stats.data.home_currency}
              expanded={expanded}
              onToggle={toggle}
              incomplete={incomplete}
              goodWhenUp
            />
          </div>
        )
      )}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-6">
        <h1
          className="m-0 my-1 block h-[1em] max-w-full rounded-lg bg-gray-150 text-xl font-medium motion-safe:animate-pulse"
          style={{ inlineSize: "11rem" }}
        />
        <p
          className="my-1 block h-[1em] max-w-full rounded-lg bg-gray-150 text-sm text-gray-700 motion-safe:animate-pulse"
          style={{ inlineSize: "15rem" }}
        />
      </div>
      <section className="mb-6 flex w-full flex-col gap-2 min-[30rem]:flex-row">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[5.5rem] w-full rounded-2xl bg-gray-150 motion-safe:animate-pulse"
          />
        ))}
      </section>
      <div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="my-4 h-5 rounded-lg bg-gray-150 motion-safe:animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

function Summary(props: {
  label: string;
  value: StatsAmount;
  currency: string;
  incomplete: boolean;
  goodWhenUp: boolean;
}) {
  const { f } = useI18n();
  const difference = props.value.current - props.value.comparison;
  const showPercent =
    !props.incomplete && props.value.comparison !== 0 && difference !== 0;

  return (
    <article className="w-full min-w-0 rounded-2xl bg-gray-100 p-3 flex flex-col gap-1">
      <h2 className="text-sm font-semibold leading-5 text-gray-500">
        {props.label}
      </h2>

      <div className="flex flex-col justify-end h-full">
        {showPercent ? (
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium ${difference > 0 === props.goodWhenUp ? "text-(--green-fg)" : "text-(--red-fg)"}`}
          >
            {difference > 0 ? (
              <ArrowUpRightIcon
                className="size-2.5"
                strokeWidth={2.5}
                aria-hidden="true"
              />
            ) : (
              <ArrowDownRightIcon
                className="size-2.5"
                strokeWidth={2.5}
                aria-hidden="true"
              />
            )}

            <span>
              {f.percent(difference / Math.abs(props.value.comparison))}
            </span>
          </span>
        ) : (
          <span aria-hidden="true" className="invisible">
            0
          </span>
        )}

        <strong className="block text-xl font-semibold leading-6 wrap-anywhere tabular-nums">
          {f.amount(props.value.current, props.currency)}
        </strong>

        <p className="text-xs text-gray-700 tabular-nums mt-1">
          vs {f.amount(props.value.comparison, props.currency)}
        </p>
      </div>
    </article>
  );
}

function ValuationNotice(props: {
  valuation: { current: Valuation; comparison: Valuation };
}) {
  const values = [props.valuation.current, props.valuation.comparison];
  const fallbackCount = values.reduce(
    (sum, value) => sum + value.fallback_transactions,
    0,
  );
  const oldest = Math.max(
    ...values.map((value) => value.maximum_fallback_days),
  );
  const missing = [
    ...new Set(values.flatMap((value) => value.unvalued_currencies)),
  ];

  if (fallbackCount === 0 && missing.length === 0) return null;

  return (
    <aside className="mb-6 rounded-2xl border-0 bg-gray-100 p-3 text-sm text-gray-700">
      {fallbackCount > 0 && (
        <p>
          Some values use an earlier exchange rate, up to {oldest} days old.
        </p>
      )}
      {missing.length > 0 && (
        <p>
          {missing.join(", ")} could not be valued and is excluded from totals.
        </p>
      )}
    </aside>
  );
}

function CategorySection(props: {
  title: string;
  categories: CategoryValue[];
  currency: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  incomplete: boolean;
  goodWhenUp: boolean;
}) {
  if (props.categories.length === 0) return null;

  const max = Math.max(...props.categories.map((row) => row.current), 0);

  return (
    <section className="mb-6">
      <h2 className="mb-2 ms-2.5 text-lg font-medium">{props.title}</h2>
      <ul className="list-none space-y-1.5 rounded-2xl">
        {props.categories.map((category) => {
          const details = [
            ...(category.direct ? [category.direct] : []),
            ...category.children,
          ];
          const isExpanded = props.expanded.has(category.id);
          return (
            <li key={category.id}>
              <CategoryRow
                category={category}
                currency={props.currency}
                max={max}
                incomplete={props.incomplete}
                goodWhenUp={props.goodWhenUp}
                showBar={props.categories.length > 1}
                expandable={details.length > 0}
                expanded={isExpanded}
                onToggle={() => props.onToggle(category.id)}
              />
              {isExpanded && (
                <ul className="ml-6 list-none space-y-1.5">
                  {details.map((child) => (
                    <li key={child.id}>
                      <CategoryRow
                        category={child}
                        currency={props.currency}
                        max={max}
                        incomplete={props.incomplete}
                        goodWhenUp={props.goodWhenUp}
                        showBar={details.length > 1}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CategoryRow(props: {
  category: CategoryValue;
  currency: string;
  max: number;
  incomplete: boolean;
  goodWhenUp: boolean;
  showBar: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const { f } = useI18n();
  const difference = props.category.current - props.category.comparison;
  const showPercent =
    !props.incomplete && props.category.comparison > 0 && difference !== 0;

  const content = (
    <div className="flex justify-between gap-3 w-full leading-5">
      <div>
        <span className="relative z-1 inline-flex items-center gap-1 font-medium">
          {props.category.name}
          {props.expandable && (
            <ChevronRightIcon
              className="size-4 shrink-0 transition-transform duration-150 [button[aria-expanded=true]_&]:rotate-90"
              aria-hidden="true"
            />
          )}
        </span>
      </div>

      <div className="flex flex-col">
        <span className="relative z-1 text-end font-medium">
          {f.wholeAmount(props.category.current, props.currency)}
        </span>
        <span className="relative z-1 text-end text-xs text-gray-900">
          vs {f.wholeAmount(props.category.comparison, props.currency)}
          {showPercent && (
            <>
              {" "}
              <span
                className={
                  difference > 0 === props.goodWhenUp
                    ? "text-green-950 py-0.5 px-1 bg-green-220 border border-green-300/80 rounded-md text-[0.65rem]"
                    : "text-red-950 py-0.5 px-1 bg-red-280 border border-red-300/80 rounded-md text-[0.65rem]"
                }
              >
                {f.percent(difference / props.category.comparison)}
              </span>
            </>
          )}
        </span>
        <span className="absolute inset-0 -z-1 bg-gray-100">
          {props.showBar && (
            <span
              className="block h-full bg-(--stats-bar-visual)"
              style={{
                width: `${props.max > 0 ? (Math.max(props.category.current, 0) / props.max) * 100 : 0}%`,
              }}
            />
          )}
        </span>
      </div>
    </div>
  );

  if (!props.expandable) {
    return (
      <div className="p-2.5 relative isolate w-full overflow-hidden rounded-xl border-0 bg-transparent text-start text-gray-900">
        {content}
      </div>
    );
  }

  return (
    <button
      className="px-3 py-2 relative isolate w-full cursor-pointer overflow-hidden rounded-xl bg-transparent text-start text-gray-900 hover:bg-gray-100 hover:shadow-[0_1px_3px] hover:shadow-gray-200"
      aria-expanded={props.expanded}
      onClick={() => props.onToggle?.()}
    >
      {content}
    </button>
  );
}
