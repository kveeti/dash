import { useState } from "react";

import { useBucketsQuery, type Bucket } from "../../api/buckets";
import {
  useStatsQuery,
  type StatsAmount,
  type StatsComparison,
  type StatsPeriod,
  type Valuation,
} from "../../api/stats";
import { setSearchParams, useSearchParam } from "../../lib/search-param";
import { useI18n } from "../i18n/use-i18n";

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
  const { isLoading: i18nLoading, isError: i18nError } = useI18n();
  const today = dateString(new Date());
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
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
    <div className={styles.page}>
      <header className={styles.controls}>
        {period === "custom" && (
          <div className={styles.customDates}>
            <input
              className={inputStyles.control}
              aria-label="From date"
              type="date"
              max={today}
              value={from}
              onInput={(event) => update({ from: event.currentTarget.value })}
            />
            <span>to</span>
            <input
              className={inputStyles.control}
              aria-label="To date"
              type="date"
              max={today}
              value={to}
              onInput={(event) => update({ to: event.currentTarget.value })}
            />
          </div>
        )}

        <div className={styles.tabs} aria-label="Stats period">
          {(["week", "month", "year", "custom"] as StatsPeriod[]).map(
            (value) => (
              <button
                key={value}
                data-label={value}
                className={period === value ? styles.active : undefined}
                onClick={() => setPeriod(value)}
              >
                {value}
              </button>
            ),
          )}
        </div>

        <div
          className={`${styles.periodNav}${period === "custom" ? ` ${styles.ghost}` : ""}`}
        >
          <button
            className={styles.prev}
            aria-label="Previous period"
            onClick={() =>
              update({ anchor: movePeriod(anchor, navPeriod, -1) })
            }
          />
          <button
            className={`${styles.next}${canGoNext ? "" : ` ${styles.ghost}`}`}
            aria-label="Next period"
            onClick={() => update({ anchor: movePeriod(anchor, navPeriod, 1) })}
          />
        </div>

        <div
          className={`${styles.compare}${canCompareYear ? "" : ` ${styles.ghost}`}`}
        >
          <span>Compare with</span>
          <div className={styles.pill}>
            <button
              data-label="previous"
              className={comparison === "previous" ? styles.active : undefined}
              onClick={() => update({ compare: "previous" })}
            >
              previous
            </button>
            <button
              data-label="last year"
              className={comparison === "year" ? styles.active : undefined}
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
        <p className={styles.error}>
          error:{" "}
          {(stats.error ?? buckets.error)?.message ??
            "loading currencies failed"}
        </p>
      ) : (
        buckets.data &&
        stats.data && (
          <div className={stats.isPlaceholderData ? styles.stale : undefined}>
            <div className={styles.heading}>
              <h1>{formatRange(stats.data.ranges.current)}</h1>
              <p>compared with {formatRange(stats.data.ranges.comparison)}</p>
            </div>

            <section className={styles.summary} aria-label="Summary">
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
                noPercent
              />
            </section>

            <ValuationNotice valuation={stats.data.valuation} />

            {expenses.length === 0 && income.length === 0 && (
              <p className={styles.empty}>No transactions in this period.</p>
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
      <div className={styles.heading}>
        <h1 className={styles.skeletonText} style={{ inlineSize: "11rem" }} />
        <p className={styles.skeletonText} style={{ inlineSize: "15rem" }} />
      </div>
      <section className={styles.summary}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={styles.skeletonCard} />
        ))}
      </section>
      <div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.skeletonRow} />
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
  noPercent?: boolean;
}) {
  const { f } = useI18n();
  const difference = props.value.current - props.value.comparison;
  const showPercent =
    !props.noPercent &&
    !props.incomplete &&
    props.value.comparison > 0 &&
    difference !== 0;

  return (
    <article className={styles.summaryItem}>
      <h2>{props.label}</h2>
      <div className={styles.numberLine}>
        <strong>{f.amount(props.value.current, props.currency)}</strong>
      </div>

      <div className={styles.vs}>
        {showPercent && (
          <span
            className={`${styles.chip} ${difference > 0 === props.goodWhenUp ? styles.chipGood : styles.chipBad}`}
          >
            {f.percent(difference / props.value.comparison)}
          </span>
        )}

        <p>vs {f.amount(props.value.comparison, props.currency)}</p>
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
    <aside className={styles.notice}>
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
    <section className={styles.categories}>
      <h2>{props.title}</h2>
      <ul>
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
                expandable={details.length > 0}
                expanded={isExpanded}
                onToggle={() => props.onToggle(category.id)}
              />
              {isExpanded && (
                <ul className={styles.children}>
                  {details.map((child) => (
                    <li key={child.id}>
                      <CategoryRow
                        category={child}
                        currency={props.currency}
                        max={max}
                        incomplete={props.incomplete}
                        goodWhenUp={props.goodWhenUp}
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
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const { f } = useI18n();
  const difference = props.category.current - props.category.comparison;
  const showPercent =
    !props.incomplete && props.category.comparison > 0 && difference !== 0;

  const content = (
    <>
      <span className={styles.categoryName}>
        {props.category.name}
        {props.expandable && (
          <span className={styles.chevron} aria-hidden="true" />
        )}
      </span>
      <span className={styles.categoryAmount}>
        {f.wholeAmount(props.category.current, props.currency)}
      </span>
      <span className={styles.categoryComparison}>
        vs {f.wholeAmount(props.category.comparison, props.currency)}
        {showPercent && (
          <>
            {", "}
            <span
              className={
                difference > 0 === props.goodWhenUp
                  ? styles.positive
                  : styles.negative
              }
            >
              {f.percent(difference / props.category.comparison)}
            </span>
          </>
        )}
      </span>
      <span className={styles.barTrack}>
        <span
          className={styles.bar}
          style={{
            width: `${props.max > 0 ? (Math.max(props.category.current, 0) / props.max) * 100 : 0}%`,
          }}
        />
      </span>
    </>
  );

  if (!props.expandable) {
    return <div className={styles.categoryRow}>{content}</div>;
  }

  return (
    <button
      className={styles.categoryRow}
      aria-expanded={props.expanded}
      onClick={() => props.onToggle?.()}
    >
      {content}
    </button>
  );
}
