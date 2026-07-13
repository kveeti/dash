import { useSearchParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";

import { bucketsQuery, type Bucket } from "../../api/buckets";
import {
  statsQuery,
  type StatsAmount,
  type StatsComparison,
  type StatsPeriod,
} from "../../api/stats";

import inputStyles from "../../ui/input/input.module.css";
import styles from "./stats-page.module.css";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

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

function formatRange(range: { from: string; to: string }) {
  const from = dateFormat.format(utcDate(range.from));
  if (range.from === range.to) return from;
  return `${from}–${dateFormat.format(utcDate(range.to))}`;
}

function amountFormatter(currency: string, sign = false) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    ...(sign ? { signDisplay: "always" as const } : {}),
  });
}

function formatMinor(amount: number, currency: string, sign = false) {
  const formatter = amountFormatter(currency, sign);
  const digits = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(amount / 10 ** digits);
}

function formatWhole(amount: number, currency: string) {
  const digits =
    amountFormatter(currency).resolvedOptions().maximumFractionDigits;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount / 10 ** digits);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: "always",
  }).format(value);
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
      current:
        (own?.current ?? 0) +
        childValues.reduce((sum, child) => sum + child.current, 0),
      comparison:
        (own?.comparison ?? 0) +
        childValues.reduce((sum, child) => sum + child.comparison, 0),
      children: childValues,
      direct,
    });
  }
  return out.sort(
    (a, b) => b.current - a.current || b.comparison - a.comparison,
  );
}

export default function StatsPage() {
  const today = dateString(new Date());
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const monthStart = `${today.slice(0, 7)}-01`;
  const [params, setParams] = useSearchParams<{
    period?: StatsPeriod;
    anchor?: string;
    compare?: StatsComparison;
    from?: string;
    to?: string;
  }>();

  const period = (): StatsPeriod =>
    ["week", "month", "year", "custom"].includes(params.period ?? "")
      ? params.period!
      : "month";
  const canCompareYear = () =>
    period() !== "year" &&
    (period() !== "custom" ||
      (params.from ?? monthStart).slice(0, 4) ===
        (params.to ?? today).slice(0, 4));
  const comparison = (): StatsComparison =>
    params.compare === "year" && canCompareYear() ? "year" : "previous";
  const anchor = () => params.anchor ?? today;
  const from = () => params.from ?? monthStart;
  const to = () => params.to ?? today;

  const request = () => ({
    period: period(),
    compare: comparison(),
    today,
    timezone,
    ...(period() === "custom"
      ? { from: from(), to: to() }
      : { anchor: anchor() }),
  });
  const stats = useQuery(() => statsQuery(request()));
  const buckets = useQuery(bucketsQuery);
  const [expanded, setExpanded] = createSignal(new Set<string>());

  const values = createMemo(
    () =>
      new Map(
        (stats.data?.categories ?? []).map((category) => [
          category.bucket_id,
          {
            current: category.current,
            comparison: category.comparison,
          },
        ]),
      ),
  );
  const expenses = createMemo(() =>
    categoryGroups(buckets.data ?? [], values(), "expense"),
  );
  const income = createMemo(() =>
    categoryGroups(buckets.data ?? [], values(), "income"),
  );
  const incomplete = () =>
    !!stats.data &&
    (stats.data.valuation.current.unvalued_currencies.length > 0 ||
      stats.data.valuation.comparison.unvalued_currencies.length > 0);

  const setPeriod = (next: StatsPeriod) => {
    setParams({
      period: next,
      anchor: next === "custom" ? undefined : today,
      from: next === "custom" ? monthStart : undefined,
      to: next === "custom" ? today : undefined,
      compare: next === "year" ? "previous" : comparison(),
    });
  };

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div class={styles.page}>
      <header class={styles.controls}>
        <Show when={period() === "custom"}>
          <div class={styles.customDates}>
            <input
              class={inputStyles.control}
              aria-label="From date"
              type="date"
              max={today}
              value={from()}
              onInput={(event) =>
                setParams({ from: event.currentTarget.value })
              }
            />
            <span>to</span>
            <input
              class={inputStyles.control}
              aria-label="To date"
              type="date"
              max={today}
              value={to()}
              onInput={(event) => setParams({ to: event.currentTarget.value })}
            />
          </div>
        </Show>

        <div class={styles.tabs} aria-label="Stats period">
          <For each={["week", "month", "year", "custom"] as StatsPeriod[]}>
            {(value) => (
              <button
                data-label={value}
                classList={{ [styles.active]: period() === value }}
                onClick={() => setPeriod(value)}
              >
                {value}
              </button>
            )}
          </For>
        </div>

        <div
          class={styles.periodNav}
          classList={{ [styles.ghost]: period() === "custom" }}
        >
          <button
            class={styles.prev}
            aria-label="Previous period"
            onClick={() =>
              setParams({
                anchor: movePeriod(
                  anchor(),
                  period() as Exclude<StatsPeriod, "custom">,
                  -1,
                ),
              })
            }
          />
          <button
            class={styles.next}
            classList={{
              [styles.ghost]: !(
                periodStart(
                  anchor(),
                  period() as Exclude<StatsPeriod, "custom">,
                ) <
                periodStart(today, period() as Exclude<StatsPeriod, "custom">)
              ),
            }}
            aria-label="Next period"
            onClick={() =>
              setParams({
                anchor: movePeriod(
                  anchor(),
                  period() as Exclude<StatsPeriod, "custom">,
                  1,
                ),
              })
            }
          />
        </div>

        <div
          class={styles.compare}
          classList={{ [styles.ghost]: !canCompareYear() }}
        >
          <span>Compare with</span>
          <div class={styles.pill}>
            <button
              data-label="previous"
              classList={{ [styles.active]: comparison() === "previous" }}
              onClick={() => setParams({ compare: "previous" })}
            >
              previous
            </button>
            <button
              data-label="last year"
              classList={{ [styles.active]: comparison() === "year" }}
              onClick={() => setParams({ compare: "year" })}
            >
              last year
            </button>
          </div>
        </div>
      </header>

      <Switch>
        <Match when={stats.isPending || buckets.isPending}>
          <StatsSkeleton />
        </Match>
        <Match when={stats.isError || buckets.isError}>
          <p class={styles.error}>
            error: {(stats.error ?? buckets.error)?.message}
          </p>
        </Match>
        <Match when={stats.data && buckets.data}>
          <div classList={{ [styles.stale]: stats.isPlaceholderData }}>
            <div class={styles.heading}>
              <h1>{formatRange(stats.data!.ranges.current)}</h1>
              <p>compared with {formatRange(stats.data!.ranges.comparison)}</p>
            </div>

            <section class={styles.summary} aria-label="Summary">
              <Summary
                label="Expenses"
                value={stats.data!.summary.expenses}
                currency={stats.data!.home_currency}
                incomplete={incomplete()}
                goodWhenUp={false}
              />
              <Summary
                label="Income"
                value={stats.data!.summary.income}
                currency={stats.data!.home_currency}
                incomplete={incomplete()}
                goodWhenUp
              />
              <Summary
                label="Net"
                value={stats.data!.summary.net}
                currency={stats.data!.home_currency}
                incomplete={incomplete()}
                goodWhenUp
                noPercent
              />
            </section>

            <ValuationNotice valuation={stats.data!.valuation} />

            <Show when={expenses().length === 0 && income().length === 0}>
              <p class={styles.empty}>No transactions in this period.</p>
            </Show>

            <CategorySection
              title="Expenses"
              categories={expenses()}
              currency={stats.data!.home_currency}
              expanded={expanded()}
              onToggle={toggle}
              incomplete={incomplete()}
              goodWhenUp={false}
            />
            <CategorySection
              title="Income"
              categories={income()}
              currency={stats.data!.home_currency}
              expanded={expanded()}
              onToggle={toggle}
              incomplete={incomplete()}
              goodWhenUp
            />
          </div>
        </Match>
      </Switch>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div aria-hidden="true">
      <div class={styles.heading}>
        <h1 class={styles.skeletonText} style={{ "inline-size": "11rem" }} />
        <p class={styles.skeletonText} style={{ "inline-size": "15rem" }} />
      </div>
      <section class={styles.summary}>
        <For each={[0, 1, 2]}>{() => <div class={styles.skeletonCard} />}</For>
      </section>
      <div>
        <For each={[0, 1, 2, 3, 4]}>
          {() => <div class={styles.skeletonRow} />}
        </For>
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
  noPercent?: boolean;
}) {
  const difference = () => props.value.current - props.value.comparison;
  const showPercent = () =>
    !props.noPercent &&
    !props.incomplete &&
    props.value.comparison > 0 &&
    difference() !== 0;

  return (
    <article class={styles.summaryItem}>
      <h2>{props.label}</h2>
      <div class={styles.numberLine}>
        <strong>{formatMinor(props.value.current, props.currency)}</strong>
      </div>

      <div class={styles.vs}>
        <Show when={showPercent()}>
          <span
            class={styles.chip}
            classList={{
              [styles.chipGood]: difference() > 0 === props.goodWhenUp,
              [styles.chipBad]: difference() > 0 !== props.goodWhenUp,
            }}
          >
            {formatPercent(difference() / props.value.comparison)}
          </span>
        </Show>

        <p>vs {formatMinor(props.value.comparison, props.currency)}</p>
      </div>
    </article>
  );
}

function ValuationNotice(props: {
  valuation: {
    current: {
      fallback_transactions: number;
      maximum_fallback_days: number;
      unvalued_currencies: string[];
    };
    comparison: {
      fallback_transactions: number;
      maximum_fallback_days: number;
      unvalued_currencies: string[];
    };
  };
}) {
  const values = () => [props.valuation.current, props.valuation.comparison];
  const fallbackCount = () =>
    values().reduce((sum, value) => sum + value.fallback_transactions, 0);
  const oldest = () =>
    Math.max(...values().map((value) => value.maximum_fallback_days));
  const missing = () => [
    ...new Set(values().flatMap((value) => value.unvalued_currencies)),
  ];

  return (
    <Show when={fallbackCount() > 0 || missing().length > 0}>
      <aside class={styles.notice}>
        <Show when={fallbackCount() > 0}>
          <p>
            Some values use an earlier exchange rate, up to {oldest()} days old.
          </p>
        </Show>
        <Show when={missing().length > 0}>
          <p>
            {missing().join(", ")} could not be valued and is excluded from
            totals.
          </p>
        </Show>
      </aside>
    </Show>
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
  const max = () => Math.max(...props.categories.map((row) => row.current), 0);

  return (
    <Show when={props.categories.length > 0}>
      <section class={styles.categories}>
        <h2>{props.title}</h2>
        <ul>
          <For each={props.categories}>
            {(category) => {
              const details = () => [
                ...(category.direct ? [category.direct] : []),
                ...category.children,
              ];
              return (
                <li>
                  <CategoryRow
                    category={category}
                    currency={props.currency}
                    max={max()}
                    incomplete={props.incomplete}
                    goodWhenUp={props.goodWhenUp}
                    expandable={details().length > 0}
                    expanded={props.expanded.has(category.id)}
                    onToggle={() => props.onToggle(category.id)}
                  />
                  <Show when={props.expanded.has(category.id)}>
                    <ul class={styles.children}>
                      <For each={details()}>
                        {(child) => (
                          <li>
                            <CategoryRow
                              category={child}
                              currency={props.currency}
                              max={max()}
                              incomplete={props.incomplete}
                              goodWhenUp={props.goodWhenUp}
                            />
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </section>
    </Show>
  );
}

function CategoryRow(props: {
  category: CategoryValue;
  currency: string;
  max: number;
  incomplete: boolean;
  goodWhenUp: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const difference = () => props.category.current - props.category.comparison;
  const showPercent = () =>
    !props.incomplete && props.category.comparison > 0 && difference() !== 0;
  const content = () => (
    <>
      <span class={styles.categoryName}>
        {props.category.name}
        <Show when={props.expandable}>
          <span class={styles.chevron} aria-hidden="true" />
        </Show>
      </span>
      <span class={styles.categoryAmount}>
        {formatWhole(props.category.current, props.currency)}
      </span>
      <span class={styles.categoryComparison}>
        vs {formatWhole(props.category.comparison, props.currency)}
        <Show when={showPercent()}>
          {", "}
          <span
            classList={{
              [styles.positive]: difference() > 0 === props.goodWhenUp,
              [styles.negative]: difference() > 0 !== props.goodWhenUp,
            }}
          >
            {formatPercent(difference() / props.category.comparison)}
          </span>
        </Show>
      </span>
      <span class={styles.barTrack}>
        <span
          class={styles.bar}
          style={{
            width: `${props.max > 0 ? (Math.max(props.category.current, 0) / props.max) * 100 : 0}%`,
          }}
        />
      </span>
    </>
  );

  return (
    <Show
      when={props.expandable}
      fallback={<div class={styles.categoryRow}>{content()}</div>}
    >
      <button
        class={styles.categoryRow}
        aria-expanded={props.expanded}
        onClick={() => props.onToggle?.()}
      >
        {content()}
      </button>
    </Show>
  );
}
