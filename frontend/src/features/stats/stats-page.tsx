import { ChartBarIcon } from "@heroicons/react/24/outline";
import { useState } from "react";

import { useBucketsQuery } from "../../api/buckets";
import {
  useStatsQuery,
  type StatsComparison,
  type StatsPeriod,
} from "../../api/stats";
import { ListEmptyState } from "../../lib/list-shell/list-empty-state";
import { setSearchParams, useSearchParam } from "../../lib/search-param";
import { useI18n } from "../i18n/use-i18n";
import { CategorySection } from "./stats-categories";
import { categoryGroups } from "./stats-category-groups";
import { StatsPeriodControls } from "./stats-period-controls";
import { StatsSkeleton } from "./stats-skeleton";
import { Summary, ValuationNotice } from "./stats-summary";

function dateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
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

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mx-auto w-full max-w-(--page-width) p-3 pb-41 pwa:pb-46 sm:p-6">
      <StatsPeriodControls
        period={period}
        comparison={comparison}
        today={today}
        monthStart={monthStart}
        from={from}
        to={to}
        anchor={anchor}
        canCompareYear={canCompareYear}
        update={update}
      />

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
