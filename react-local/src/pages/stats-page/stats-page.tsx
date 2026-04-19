import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "wouter";
import {
	useConvertedStatTransactionsQuery,
	useConvertedStatsSummaryQuery,
	useMonthStatsQuery,
	useStatsQuery,
	useTransactionYearsQuery,
	type ConvertedStatTransactionRow,
	type ConvertedStatsSummary,
	type MonthStatRow,
	type StatRow,
	type TransactionYearRow,
} from "../../lib/queries/stats";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "../../components/tabs";
import { useI18n } from "../../providers";
import { useAppSettingsQuery } from "../../lib/queries/settings";

function getYearBounds(year: number): [string, string] {
	const y = String(year);
	return [`${y}-01-01`, `${y}-12-31`];
}

function getMonthBounds(period: string): [string, string] {
	const [yearStr, monthStr] = period.split("-");
	const year = Number(yearStr);
	const month = Number(monthStr);
	const from = `${period}-01`;
	const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
	return [from, to];
}

type YearSummary = {
	year: number;
	txCount: number;
};

type MonthSummary = {
	period: string;
	income: number;
	expense: number;
	neutral: number;
	txCount: number;
	unconvertedCount: number;
};

type CategoryTotal = {
	bucket: "i" | "e" | "n";
	catName: string;
	amount: number;
	txCount: number;
	unconvertedCount: number;
};

type StatsTabValue = "stats-1" | "stats-2";
type StatsRangeValue = "6m" | "12m" | "24m";

function parseStatsTabValue(value: string | null): StatsTabValue {
	return value === "stats-2" ? "stats-2" : "stats-1";
}

function parseStatsRangeValue(value: string | null): StatsRangeValue {
	if (value === "6m" || value === "24m") return value;
	return "12m";
}

function statsRangeMonths(value: StatsRangeValue): number {
	if (value === "6m") return 6;
	if (value === "24m") return 24;
	return 12;
}

export function StatsPage() {
	const settings = useAppSettingsQuery();
	const [searchParams] = useSearchParams();
	const [, navigate] = useLocation();
	const activeTab = parseStatsTabValue(searchParams.get("tab"));
	const range = parseStatsRangeValue(searchParams.get("range"));

	const reportingCurrency = settings.data?.reporting_currency ?? "EUR";
	const mode = settings.data?.conversion_mode ?? "strict";
	const maxStalenessDays = settings.data?.max_staleness_days ?? 7;

	const yearStats = useTransactionYearsQuery();
	const yearRows = yearStats.data ?? [];
	const setStatsParams = (updates: Record<string, string | undefined>) => {
		const params = new URLSearchParams(searchParams);
		for (const [key, value] of Object.entries(updates)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		const qs = params.toString();
		navigate(qs ? `/stats?${qs}` : "/stats");
	};

	useEffect(() => {
		const tabParam = searchParams.get("tab");
		const rangeParam = searchParams.get("range");
		const updates: Record<string, string | undefined> = {};
		if (tabParam !== activeTab) updates.tab = activeTab;
		if (rangeParam !== range) updates.range = range;
		if (Object.keys(updates).length === 0) return;

		const params = new URLSearchParams(searchParams);
		for (const [key, value] of Object.entries(updates)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		const qs = params.toString();
		navigate(qs ? `/stats?${qs}` : "/stats");
	}, [activeTab, navigate, range, searchParams]);

	return (
		<div className="w-full mx-auto max-w-[900px] mt-14 px-4">
			<h1 className="text-lg mb-4">stats</h1>

			{(settings.isLoading || yearStats.isLoading) && (
				<p className="text-sm text-gray-10">loading...</p>
			)}
			{yearStats.isError && (
				<pre className="text-sm text-red-11 whitespace-pre-wrap">{String(yearStats.error)}</pre>
			)}

				<TabsRoot
					value={activeTab}
					onValueChange={(value) => {
						if (value === "stats-1" || value === "stats-2") {
							setStatsParams({ tab: value });
						}
					}}
				>
				<TabsList aria-label="stats versions">
					<TabsTab value="stats-1">stats 1</TabsTab>
					<TabsTab value="stats-2">stats 2</TabsTab>
				</TabsList>

				<TabsPanel value="stats-1">
					<DesktopYearMonthExplorer
						yearRows={yearRows}
						reportingCurrency={reportingCurrency}
						queryReportingCurrency={settings.data?.reporting_currency}
						mode={mode}
						maxStalenessDays={maxStalenessDays}
						enabled={activeTab === "stats-1"}
					/>
				</TabsPanel>

					<TabsPanel value="stats-2">
						<StatsOverviewPanel
							reportingCurrency={reportingCurrency}
							queryReportingCurrency={settings.data?.reporting_currency}
							mode={mode}
							maxStalenessDays={maxStalenessDays}
							range={range}
							onRangeChange={(value) => setStatsParams({ range: value })}
							enabled={activeTab === "stats-2"}
						/>
					</TabsPanel>
			</TabsRoot>
		</div>
	);
}

function ConvertedSummaryCard({
	summary,
	className,
}: {
	summary: ConvertedStatsSummary;
	className?: string;
}) {
	const { f } = useI18n();
	const coverageCount = (summary.coverage_count_ratio * 100).toFixed(1);
	const coverageAmount = (summary.coverage_amount_ratio * 100).toFixed(1);
	const isPartial = summary.converted_count < summary.total_count;

	return (
		<div className={"border border-gray-a4 p-3 text-xs space-y-1 " + (className ?? "")}>
			<p className="text-gray-10">
				reporting currency: <span className="text-gray-12">{summary.reporting_currency}</span>
				{" "}({summary.mode}, stale limit {summary.max_staleness_days}d)
			</p>
			<p className="text-sm">
				converted total:{" "}
				<strong>{f.amount(summary.converted_total, summary.reporting_currency)}</strong>
			</p>
			<p className={isPartial ? "text-orange-11" : "text-gray-10"}>
				coverage: {summary.converted_count}/{summary.total_count} tx ({coverageCount}%),
				amount coverage {coverageAmount}%
			</p>
			{summary.missing_by_currency.length > 0 && (
				<ul className="text-gray-10">
					{summary.missing_by_currency.slice(0, 5).map((row) => (
						<li key={row.currency}>
							missing {row.currency}: {row.count} tx, {f.amount(row.amount, row.currency)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function summarizeYears(rows: TransactionYearRow[]): YearSummary[] {
	const map = new Map<number, YearSummary>();
	for (const row of rows) {
		const year = Number(row.year);
		if (!Number.isFinite(year)) continue;
		map.set(year, {
			year,
			txCount: Number(row.tx_count || 0),
		});
	}
	return [...map.values()].sort((a, b) => b.year - a.year);
}

function summarizeMonths(rows: MonthStatRow[]): MonthSummary[] {
	const map = new Map<string, MonthSummary>();
	for (const row of rows) {
		const existing = map.get(row.period) ?? {
			period: row.period,
			income: 0,
			expense: 0,
			neutral: 0,
			txCount: 0,
			unconvertedCount: 0,
		};
		if (row.bucket === "i") existing.income += row.amount;
		else if (row.bucket === "e") existing.expense += row.amount;
		else existing.neutral += row.amount;
		existing.txCount += row.tx_count;
		existing.unconvertedCount += row.unconverted_count;
		map.set(row.period, existing);
	}
	return [...map.values()].sort((a, b) => b.period.localeCompare(a.period));
}

function summarizeCategoryTotals(rows: StatRow[]): CategoryTotal[] {
	const map = new Map<string, CategoryTotal>();
	for (const row of rows) {
		if (row.bucket !== "i" && row.bucket !== "e" && row.bucket !== "n") continue;
		const key = `${row.bucket}|${row.cat_name}`;
		const existing = map.get(key) ?? {
			bucket: row.bucket,
			catName: row.cat_name,
			amount: 0,
			txCount: 0,
			unconvertedCount: 0,
		};
		existing.amount += row.amount;
		existing.txCount += row.tx_count;
		existing.unconvertedCount += row.unconverted_count;
		map.set(key, existing);
	}
	return [...map.values()].sort((a, b) => b.amount - a.amount);
}

function listRecentPeriods(count: number, now: Date): string[] {
	const periods: string[] = [];
	for (let offset = count - 1; offset >= 0; offset -= 1) {
		const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - offset, 1));
		const year = String(date.getUTCFullYear());
		const month = String(date.getUTCMonth() + 1).padStart(2, "0");
		periods.push(`${year}-${month}`);
	}
	return periods;
}

function formatSignedPercent(value: number | null, digits = 1) {
	if (value == null || !Number.isFinite(value)) return "n/a";
	const sign = value >= 0 ? "+" : "";
	return `${sign}${value.toFixed(digits)}%`;
}

function displayCategoryName(catName: string) {
	return catName === "__uncategorized__" ? "uncategorized" : catName;
}

function DesktopYearMonthExplorer({
	yearRows,
	reportingCurrency,
	queryReportingCurrency,
	mode,
	maxStalenessDays,
	enabled,
}: {
	yearRows: TransactionYearRow[];
	reportingCurrency: string;
	queryReportingCurrency?: string;
	mode: "strict" | "lenient";
	maxStalenessDays: number;
	enabled: boolean;
}) {
	const { f } = useI18n();
	const now = useMemo(() => new Date(), []);
	const currentYear = now.getFullYear();
	const currentPeriod = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;

	const years = useMemo(() => summarizeYears(yearRows), [yearRows]);

	const [yearSelection, setYearSelection] = useState<number | null>(null);
	const selectedYear = useMemo(() => {
		if (years.length === 0) return null;
		if (yearSelection != null && years.some((y) => y.year === yearSelection)) {
			return yearSelection;
		}
		if (years.some((y) => y.year === currentYear)) {
			return currentYear;
		}
		return years[0].year;
	}, [years, yearSelection, currentYear]);

	const selectedYearRange = useMemo(
		() => (selectedYear == null ? null : getYearBounds(selectedYear)),
		[selectedYear],
	);

	const monthStats = useMonthStatsQuery({
		from: selectedYearRange?.[0] ?? "",
		to: selectedYearRange?.[1] ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: enabled && !!selectedYearRange && !!queryReportingCurrency,
	});
	const months = useMemo(() => summarizeMonths(monthStats.data ?? []), [monthStats.data]);

	const [periodSelection, setPeriodSelection] = useState<string | null>(null);
	const selectedPeriod = useMemo(() => {
		if (months.length === 0) return null;
		if (periodSelection && months.some((month) => month.period === periodSelection)) {
			return periodSelection;
		}
		if (selectedYear === currentYear && months.some((month) => month.period === currentPeriod)) {
			return currentPeriod;
		}
		return months[0].period;
	}, [months, periodSelection, selectedYear, currentYear, currentPeriod]);

	const selectedMonthRange = useMemo(
		() => (selectedPeriod ? getMonthBounds(selectedPeriod) : null),
		[selectedPeriod],
	);

	const summaryQuery = useConvertedStatsSummaryQuery({
		from: selectedYearRange?.[0] ?? "",
		to: selectedYearRange?.[1] ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: enabled && !!selectedYearRange && !!queryReportingCurrency,
	});

	const monthCategoryQuery = useStatsQuery({
		from: selectedMonthRange?.[0] ?? "",
		to: selectedMonthRange?.[1] ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: enabled && !!selectedMonthRange && !!queryReportingCurrency,
	});
	const detailRows = useMemo(
		() =>
			(monthCategoryQuery.data ?? []).slice().sort(
				(a, b) => a.bucket.localeCompare(b.bucket) || b.amount - a.amount,
			),
		[monthCategoryQuery.data],
	);

	const detailTransactionsQuery = useConvertedStatTransactionsQuery({
		from: selectedMonthRange?.[0] ?? "",
		to: selectedMonthRange?.[1] ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		perCategoryLimit: 12,
		enabled: enabled && !!selectedMonthRange && !!queryReportingCurrency,
	});
	const detailTransactions = detailTransactionsQuery.data ?? [];

	if (yearRows.length === 0) {
		return <p className="text-sm text-gray-10">no data</p>;
	}

	const isLoading = summaryQuery.isLoading || monthCategoryQuery.isLoading || detailTransactionsQuery.isLoading;

	return (
		<>
			<div className="md:hidden text-xs text-gray-10 border border-gray-a4 p-3">
				Year/month explorer is available on wider screens.
			</div>
			<div className="hidden md:grid md:grid-cols-[12rem_20rem_1fr] gap-4">
				<div className="border border-gray-a4 w-full">
					<div className="border-b border-gray-a4 px-3 py-2 text-xs text-gray-10 font-mono">
						years
					</div>
					<div className="max-h-[72dvh] overflow-auto p-2 space-y-2">
						{years.map((year) => {
							const isSelected = year.year === selectedYear;
							return (
								<button
									key={year.year}
									type="button"
									onMouseEnter={() => {
										setYearSelection(year.year);
										setPeriodSelection(null);
									}}
									onFocus={() => {
										setYearSelection(year.year);
										setPeriodSelection(null);
									}}
									onClick={() => {
										setYearSelection(year.year);
										setPeriodSelection(null);
									}}
									className={
										"w-full border px-3 py-2 text-left font-mono text-xs transition-colors " +
										(isSelected
											? "border-gray-8 bg-gray-a3"
											: "border-gray-a4 hover:bg-gray-a2")
									}
								>
									<div className="mb-1 text-sm text-gray-12">{year.year}</div>
									<div className="text-gray-10">{year.txCount} tx</div>
								</button>
							);
						})}
					</div>
				</div>

				<div className="border border-gray-a4">
					<div className="border-b border-gray-a4 px-3 py-2 text-xs text-gray-10 font-mono">
						months {selectedYear ?? ""}
					</div>
					<div className="max-h-[72dvh] overflow-auto p-2 space-y-2">
						{monthStats.isLoading && <p className="text-xs text-gray-10">loading months...</p>}
						{monthStats.isError && (
							<pre className="text-xs text-red-11 whitespace-pre-wrap">
								{String(monthStats.error)}
							</pre>
						)}
						{months.map((month) => {
							const isSelected = month.period === selectedPeriod;
							return (
								<button
									key={month.period}
									type="button"
									onMouseEnter={() => setPeriodSelection(month.period)}
									onFocus={() => setPeriodSelection(month.period)}
									onClick={() => setPeriodSelection(month.period)}
									className={
										"w-full border px-3 py-2 text-left font-mono text-xs transition-colors " +
										(isSelected
											? "border-gray-8 bg-gray-a3"
											: "border-gray-a4 hover:bg-gray-a2")
									}
								>
									<div className="mb-1 text-sm text-gray-12">{month.period}</div>
									<div className="text-gray-11">+ {f.amount(month.income, reportingCurrency)}</div>
									<div className="text-gray-11">- {f.amount(month.expense, reportingCurrency)}</div>
									<div className="text-gray-10">n {f.amount(month.neutral, reportingCurrency)}</div>
									{month.unconvertedCount > 0 && (
										<div className="mt-1 text-orange-11">
											{month.unconvertedCount} unconverted / {month.txCount} tx
										</div>
									)}
								</button>
							);
						})}
					</div>
				</div>

				<div className="border border-gray-a4">
					<div className="border-b border-gray-a4 px-3 py-2 text-xs text-gray-10 font-mono">
						{selectedPeriod ? `details ${selectedPeriod}` : "details"}
					</div>
					<div className="p-3 space-y-4">
						{isLoading ? <p className="text-xs text-gray-10">loading...</p> : (
							<>
								{summaryQuery.isError && (
									<pre className="text-xs text-red-11 whitespace-pre-wrap">
										{String(summaryQuery.error)}
									</pre>
								)}
								{summaryQuery.data && (
									<ConvertedSummaryCard summary={summaryQuery.data} className="mb-4" />
								)}

								{monthCategoryQuery.isError && (
									<pre className="text-xs text-red-11 whitespace-pre-wrap">
										{String(monthCategoryQuery.error)}
									</pre>
								)}
								{detailTransactionsQuery.isError && (
									<pre className="text-xs text-red-11 whitespace-pre-wrap">
										{String(detailTransactionsQuery.error)}
									</pre>
								)}
								<BucketSection
									label="income"
									bucket="i"
									rows={detailRows}
									transactions={detailTransactions}
									reportingCurrency={reportingCurrency}
								/>
								<BucketSection
									label="expense"
									bucket="e"
									rows={detailRows}
									transactions={detailTransactions}
									reportingCurrency={reportingCurrency}
								/>
								<BucketSection
									label="neutral"
									bucket="n"
									rows={detailRows}
									transactions={detailTransactions}
									reportingCurrency={reportingCurrency}
								/>
							</>
						)}
					</div>
				</div>
			</div>
		</>
	);
}

function StatsOverviewPanel({
	reportingCurrency,
	queryReportingCurrency,
	mode,
	maxStalenessDays,
	range,
	onRangeChange,
	enabled,
}: {
	reportingCurrency: string;
	queryReportingCurrency?: string;
	mode: "strict" | "lenient";
	maxStalenessDays: number;
	range: StatsRangeValue;
	onRangeChange: (value: StatsRangeValue) => void;
	enabled: boolean;
}) {
	const { f, locale } = useI18n();
	const now = useMemo(() => new Date(), []);
	const windowMonths = useMemo(() => statsRangeMonths(range), [range]);
	const periods = useMemo(() => listRecentPeriods(windowMonths, now), [now, windowMonths]);
	const firstPeriod = periods[0] ?? null;
	const lastPeriod = periods[periods.length - 1] ?? null;
	const rollingRange = useMemo(() => {
		if (!firstPeriod || !lastPeriod) return null;
		const [from] = getMonthBounds(firstPeriod);
		const [, to] = getMonthBounds(lastPeriod);
		return [from, to] as const;
	}, [firstPeriod, lastPeriod]);

	const monthStatsQuery = useMonthStatsQuery({
		from: rollingRange?.[0] ?? "",
		to: rollingRange?.[1] ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: enabled && !!rollingRange && !!queryReportingCurrency,
	});
	const categoryStatsQuery = useStatsQuery({
		from: rollingRange?.[0] ?? "",
		to: rollingRange?.[1] ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: enabled && !!rollingRange && !!queryReportingCurrency,
	});
	const summaryQuery = useConvertedStatsSummaryQuery({
		from: rollingRange?.[0] ?? "",
		to: rollingRange?.[1] ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: enabled && !!rollingRange && !!queryReportingCurrency,
	});

	const monthSummaryByPeriod = useMemo(() => {
		const map = new Map<string, MonthSummary>();
		for (const row of summarizeMonths(monthStatsQuery.data ?? [])) {
			map.set(row.period, row);
		}
		return map;
	}, [monthStatsQuery.data]);

	const trendRows = useMemo(
		() =>
			periods.map((period) => {
				const row = monthSummaryByPeriod.get(period) ?? {
					period,
					income: 0,
					expense: 0,
					neutral: 0,
					txCount: 0,
					unconvertedCount: 0,
				};
				const net = row.income - row.expense;
				const savingsRate = row.income > 0 ? net / row.income : null;
				return {
					...row,
					net,
					savingsRate,
				};
			}),
		[periods, monthSummaryByPeriod],
	);

	const currentMonth = trendRows[trendRows.length - 1] ?? null;
	const previousMonth = trendRows.length > 1 ? trendRows[trendRows.length - 2] : null;
	const netChangePct =
		currentMonth && previousMonth && previousMonth.net !== 0
			? ((currentMonth.net - previousMonth.net) / Math.abs(previousMonth.net)) * 100
			: null;

	const categoryTotals = useMemo(
		() => summarizeCategoryTotals(categoryStatsQuery.data ?? []),
		[categoryStatsQuery.data],
	);
	const incomeCategoryTotals = useMemo(
		() => categoryTotals.filter((row) => row.bucket === "i").slice(0, 5),
		[categoryTotals],
	);
	const expenseCategoryTotals = useMemo(
		() => categoryTotals.filter((row) => row.bucket === "e").slice(0, 5),
		[categoryTotals],
	);
	const totalIncomeAmount = useMemo(
		() =>
			categoryTotals
				.filter((row) => row.bucket === "i")
				.reduce((sum, row) => sum + row.amount, 0),
		[categoryTotals],
	);
	const totalExpenseAmount = useMemo(
		() =>
			categoryTotals
				.filter((row) => row.bucket === "e")
				.reduce((sum, row) => sum + row.amount, 0),
		[categoryTotals],
	);

	const totalTx = useMemo(
		() => categoryTotals.reduce((sum, row) => sum + row.txCount, 0),
		[categoryTotals],
	);
	const uncategorizedTx = useMemo(
		() =>
			categoryTotals
				.filter((row) => row.catName === "__uncategorized__")
				.reduce((sum, row) => sum + row.txCount, 0),
		[categoryTotals],
	);
	const uncategorizedRatio = totalTx > 0 ? uncategorizedTx / totalTx : 0;

	const summary = summaryQuery.data;
	const missingFxCount = summary ? summary.total_count - summary.converted_count : 0;
	const missingFxRatio = summary?.total_count
		? missingFxCount / summary.total_count
		: 0;
	const coverageAmountRatio = summary?.coverage_amount_ratio ?? 1;

	const monthLabelFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				month: "short",
				year: "numeric",
			}),
		[locale],
	);
	const formatPeriodLabel = (period: string) => {
		const [yearStr, monthStr] = period.split("-");
		const year = Number(yearStr);
		const month = Number(monthStr);
		return monthLabelFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
	};

	if (!enabled) return null;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-2">
				<div className="text-xs text-gray-10 font-mono">rolling period</div>
				<div className="inline-flex border border-gray-a4 bg-gray-1 p-1 text-xs font-mono">
					{(["6m", "12m", "24m"] as const).map((value) => {
						const isActive = value === range;
						return (
							<button
								key={value}
								type="button"
								onClick={() => onRangeChange(value)}
								className={
									"px-2 py-1 transition-colors " +
									(isActive ? "bg-gray-a3 text-gray-12" : "text-gray-10 hover:bg-gray-a2")
								}
							>
								{value}
							</button>
						);
					})}
				</div>
			</div>

			{(monthStatsQuery.isLoading || categoryStatsQuery.isLoading || summaryQuery.isLoading) && (
				<p className="text-xs text-gray-10">loading stats 2...</p>
			)}
			{monthStatsQuery.isError && (
				<pre className="text-xs text-red-11 whitespace-pre-wrap">
					{String(monthStatsQuery.error)}
				</pre>
			)}
			{categoryStatsQuery.isError && (
				<pre className="text-xs text-red-11 whitespace-pre-wrap">
					{String(categoryStatsQuery.error)}
				</pre>
			)}
			{summaryQuery.isError && (
				<pre className="text-xs text-red-11 whitespace-pre-wrap">
					{String(summaryQuery.error)}
				</pre>
			)}

			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				<StatsMetricCard
					label="income (this month)"
					value={currentMonth ? f.amount(currentMonth.income, reportingCurrency) : "-"}
					subvalue={currentMonth ? `${currentMonth.txCount} tx` : "no data"}
				/>
				<StatsMetricCard
					label="expense (this month)"
					value={currentMonth ? f.amount(currentMonth.expense, reportingCurrency) : "-"}
					subvalue={currentMonth ? `${currentMonth.txCount} tx` : "no data"}
				/>
				<StatsMetricCard
					label="net (this month)"
					value={currentMonth ? f.amount(currentMonth.net, reportingCurrency) : "-"}
					subvalue={`vs last month ${formatSignedPercent(netChangePct)}`}
				/>
				<StatsMetricCard
					label="savings rate (this month)"
					value={
						currentMonth
							? formatSignedPercent(
								currentMonth.savingsRate == null ? null : currentMonth.savingsRate * 100,
								1,
							)
							: "-"
					}
					subvalue={
						currentMonth
							? `${f.amount(currentMonth.income - currentMonth.expense, reportingCurrency)} net`
							: "no data"
					}
				/>
			</div>

				<div className="border border-gray-a4">
					<div className="border-b border-gray-a4 px-3 py-2 text-xs font-mono text-gray-10">
						{windowMonths}-month trend
					</div>
				<div className="overflow-auto">
					<table className="w-full min-w-[40rem] text-xs font-mono">
						<thead className="text-gray-10">
							<tr className="border-b border-gray-a3">
								<th className="px-3 py-2 text-left font-normal">month</th>
								<th className="px-3 py-2 text-right font-normal">income</th>
								<th className="px-3 py-2 text-right font-normal">expense</th>
								<th className="px-3 py-2 text-right font-normal">net</th>
								<th className="px-3 py-2 text-right font-normal">savings</th>
							</tr>
						</thead>
						<tbody>
							{trendRows.map((row) => (
								<tr key={row.period} className="border-b border-gray-a2 last:border-b-0">
									<td className="px-3 py-2 text-gray-11">{formatPeriodLabel(row.period)}</td>
									<td className="px-3 py-2 text-right">{f.amount(row.income, reportingCurrency)}</td>
									<td className="px-3 py-2 text-right">{f.amount(row.expense, reportingCurrency)}</td>
									<td className="px-3 py-2 text-right">
										<span className={row.net < 0 ? "text-red-11" : "text-gray-12"}>
											{f.amount(row.net, reportingCurrency)}
										</span>
									</td>
									<td className="px-3 py-2 text-right text-gray-11">
										{row.savingsRate == null
											? "n/a"
											: `${(row.savingsRate * 100).toFixed(1)}%`}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<CategoryTopList
					title="top expense categories"
					rows={expenseCategoryTotals}
					totalAmount={totalExpenseAmount}
					reportingCurrency={reportingCurrency}
				/>
				<CategoryTopList
					title="top income categories"
					rows={incomeCategoryTotals}
					totalAmount={totalIncomeAmount}
					reportingCurrency={reportingCurrency}
				/>
			</div>

			<div className="grid gap-3 md:grid-cols-3">
				<StatsMetricCard
					label="uncategorized tx"
					value={`${(uncategorizedRatio * 100).toFixed(1)}%`}
					subvalue={`${uncategorizedTx}/${totalTx} tx`}
				/>
				<StatsMetricCard
					label="missing FX rate"
					value={`${(missingFxRatio * 100).toFixed(1)}%`}
					subvalue={`${missingFxCount}/${summary?.total_count ?? 0} tx`}
				/>
				<StatsMetricCard
					label="amount coverage"
					value={`${(coverageAmountRatio * 100).toFixed(1)}%`}
					subvalue={`mode ${mode}, stale ${maxStalenessDays}d`}
				/>
			</div>
		</div>
	);
}

function StatsMetricCard({
	label,
	value,
	subvalue,
}: {
	label: string;
	value: string;
	subvalue: string;
}) {
	return (
		<div className="border border-gray-a4 p-3">
			<div className="text-[11px] font-mono text-gray-10">{label}</div>
			<div className="mt-1 text-sm text-gray-12">{value}</div>
			<div className="mt-1 text-[11px] font-mono text-gray-10">{subvalue}</div>
		</div>
	);
}

function CategoryTopList({
	title,
	rows,
	totalAmount,
	reportingCurrency,
}: {
	title: string;
	rows: CategoryTotal[];
	totalAmount: number;
	reportingCurrency: string;
}) {
	const { f } = useI18n();

	return (
		<div className="border border-gray-a4">
			<div className="border-b border-gray-a4 px-3 py-2 text-xs font-mono text-gray-10">{title}</div>
			<div className="space-y-3 p-3">
				{rows.length === 0 && <p className="text-xs text-gray-10">no data</p>}
				{rows.map((row) => {
					const share = totalAmount > 0 ? row.amount / totalAmount : 0;
					return (
						<div key={`${row.bucket}:${row.catName}`} className="space-y-1">
							<div className="flex items-center justify-between gap-2 text-xs font-mono">
								<span className="truncate text-gray-12">{displayCategoryName(row.catName)}</span>
								<span className="shrink-0">{f.amount(row.amount, reportingCurrency)}</span>
							</div>
							<div className="h-1.5 w-full bg-gray-a3">
								<div
									className="h-full bg-gray-9"
									style={{ width: `${Math.max(share * 100, share > 0 ? 3 : 0)}%` }}
								/>
							</div>
							<div className="text-[11px] font-mono text-gray-10">
								{row.txCount} tx · {(share * 100).toFixed(1)}%
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function BucketSection({
	label,
	bucket,
	rows,
	transactions,
	reportingCurrency,
}: {
	label: string;
	bucket: "i" | "e" | "n";
	rows: StatRow[];
	transactions: ConvertedStatTransactionRow[];
	reportingCurrency: string;
}) {
	const { f } = useI18n();
	const bucketRows = rows.filter((row) => row.bucket === bucket);
	const bucketTransactions = transactions.filter((row) => row.bucket === bucket);
	if (bucketRows.length === 0) return null;

	const total = bucketRows.reduce((sum, row) => sum + row.amount, 0);
	const totalTx = bucketRows.reduce((sum, row) => sum + row.tx_count, 0);
	const unconverted = bucketRows.reduce((sum, row) => sum + row.unconverted_count, 0);

	return (
		<div>
			<div className="mb-2 flex items-center justify-between text-xs font-mono">
				<span className="text-gray-12">{label}</span>
				<span className="text-gray-10">
					{f.amount(total, reportingCurrency)} · {totalTx} tx
					{unconverted > 0 ? ` · ${unconverted} unconverted` : ""}
				</span>
			</div>
			<div className="border border-gray-a4">
				{bucketRows.map((row) => (
					<div
						key={`${row.period}_${row.bucket}_${row.cat_name}`}
						className="border-b border-gray-a3 px-2 py-1 text-xs font-mono last:border-b-0"
					>
						<div className="flex items-center justify-between">
							<div className="truncate pr-2">
								<span className="text-gray-12">{row.cat_name}</span>
								<span className="text-gray-10">{` · ${row.tx_count} tx`}</span>
								{row.unconverted_count > 0 && (
									<span className="text-orange-11">{` · ${row.unconverted_count} miss`}</span>
								)}
							</div>
							<span className="shrink-0">{f.amount(row.amount, reportingCurrency)}</span>
						</div>
						<div className="mt-1 space-y-1">
							{bucketTransactions
								.filter((tx) => tx.cat_name === row.cat_name)
								.slice(0, 12)
								.map((tx) => {
									const convertedAmount = tx.converted_amount;
									const originalAmount = tx.original_amount;
									const isConverted =
										convertedAmount != null &&
										tx.original_currency !== reportingCurrency;
									return (
										<div
											key={tx.id}
											className="flex items-center justify-between pl-2 text-[11px]"
										>
											<span className="text-gray-10">{tx.counter_party}</span>
											<span className="text-right">
												{convertedAmount == null ? (
													<span className="text-orange-11">
														missing rate ({f.amount(originalAmount, tx.original_currency)})
													</span>
												) : (
													<>
														<span>{f.amount(convertedAmount, reportingCurrency)}</span>
														{isConverted && (
															<span className="text-gray-10">
																{" "}
																from {f.amount(originalAmount, tx.original_currency)}
															</span>
														)}
													</>
												)}
											</span>
										</div>
									);
								})}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
