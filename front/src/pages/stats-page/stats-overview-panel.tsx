import { useMemo } from "react";
import { useI18n } from "../../providers";
import { DateRangePickerInput } from "../../components/date-picker";
import {
	type MonthStatRow,
	type StatRow,
	useConvertedStatsSummaryQuery,
	useMonthStatsQuery,
	useStatsQuery,
} from "../../lib/queries/stats";
import {
	type DateRange,
	type StatsCompareValue,
	type StatsPeriodValue,
} from "./stats-page-types";

function formatIsoDate(date: Date) {
	return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string | null): Date | null {
	if (!value) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month ||
		date.getUTCDate() !== day
	) {
		return null;
	}
	return date;
}

function addDays(date: Date, days: number) {
	const copy = new Date(date.getTime());
	copy.setUTCDate(copy.getUTCDate() + days);
	return copy;
}

function addYears(date: Date, years: number) {
	return new Date(
		Date.UTC(
			date.getUTCFullYear() + years,
			date.getUTCMonth(),
			date.getUTCDate(),
		),
	);
}

function startOfMonth(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function startOfYear(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function endOfYear(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), 11, 31));
}

function normalizeCustomRange(from: string, to: string): DateRange {
	const fromDate = parseIsoDate(from);
	const toDate = parseIsoDate(to);
	if (!fromDate || !toDate) return { from, to };
	if (fromDate <= toDate) return { from, to };
	return { from: to, to: from };
}

function resolveBaseRange(
	period: StatsPeriodValue,
	customRange: DateRange,
	now: Date,
): DateRange {
	if (period === "custom") {
		return normalizeCustomRange(customRange.from, customRange.to);
	}

	const monthStart = startOfMonth(now);
	const monthEnd = endOfMonth(now);
	const lastMonthRef = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
	);
	if (period === "this-month") {
		return { from: formatIsoDate(monthStart), to: formatIsoDate(monthEnd) };
	}
	if (period === "last-month") {
		return {
			from: formatIsoDate(startOfMonth(lastMonthRef)),
			to: formatIsoDate(endOfMonth(lastMonthRef)),
		};
	}
	if (period === "this-year") {
		return {
			from: formatIsoDate(startOfYear(now)),
			to: formatIsoDate(endOfYear(now)),
		};
	}
	const lastYearRef = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
	return {
		from: formatIsoDate(startOfYear(lastYearRef)),
		to: formatIsoDate(endOfYear(lastYearRef)),
	};
}

function resolveCompareRange(
	baseRange: DateRange,
	compare: StatsCompareValue,
): DateRange | null {
	if (compare === "none") return null;
	const fromDate = parseIsoDate(baseRange.from);
	const toDate = parseIsoDate(baseRange.to);
	if (!fromDate || !toDate) return null;

	if (compare === "year-over-year") {
		return {
			from: formatIsoDate(addYears(fromDate, -1)),
			to: formatIsoDate(addYears(toDate, -1)),
		};
	}

	const spanDays =
		Math.floor(
			(toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000),
		) + 1;
	const previousTo = addDays(fromDate, -1);
	const previousFrom = addDays(previousTo, -(spanDays - 1));
	return {
		from: formatIsoDate(previousFrom),
		to: formatIsoDate(previousTo),
	};
}

function formatRangeLabel(period: StatsPeriodValue, range: DateRange) {
	if (period === "this-month") return "this month";
	if (period === "last-month") return "last month";
	if (period === "this-year") return "this year";
	if (period === "last-year") return "last year";
	return `${range.from} to ${range.to}`;
}

function formatCompareLabel(compare: StatsCompareValue) {
	if (compare === "year-over-year") return "same period last year";
	if (compare === "none") return "no comparison";
	return "previous period";
}

type OverviewTotals = {
	income: number;
	expense: number;
	neutral: number;
	net: number;
	txCount: number;
	unconvertedCount: number;
	uncategorizedCount: number;
};

type CategoryTotal = {
	bucket: "i" | "e" | "n";
	catName: string;
	amount: number;
	txCount: number;
	unconvertedCount: number;
};

type CategoryDelta = {
	catName: string;
	currentAmount: number;
	previousAmount: number;
	deltaAmount: number;
};

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

function toOverviewTotals(
	monthRows: MonthStatRow[],
	categoryRows: StatRow[],
): OverviewTotals {
	let income = 0;
	let expense = 0;
	let neutral = 0;
	let txCount = 0;
	let unconvertedCount = 0;

	for (const row of monthRows) {
		if (row.bucket === "i") income += row.amount;
		else if (row.bucket === "e") expense += row.amount;
		else neutral += row.amount;
		txCount += row.tx_count;
		unconvertedCount += row.unconverted_count;
	}

	const uncategorizedCount = categoryRows
		.filter((row) => row.cat_name === "__uncategorized__")
		.reduce((sum, row) => sum + row.tx_count, 0);

	return {
		income,
		expense,
		neutral,
		net: income - expense,
		txCount,
		unconvertedCount,
		uncategorizedCount,
	};
}

function summarizeCategoryDelta(
	currentRows: CategoryTotal[],
	previousRows: CategoryTotal[],
	bucket: "i" | "e",
): CategoryDelta[] {
	const map = new Map<string, { currentAmount: number; previousAmount: number }>();

	for (const row of currentRows) {
		if (row.bucket !== bucket) continue;
		const existing = map.get(row.catName) ?? { currentAmount: 0, previousAmount: 0 };
		existing.currentAmount += row.amount;
		map.set(row.catName, existing);
	}
	for (const row of previousRows) {
		if (row.bucket !== bucket) continue;
		const existing = map.get(row.catName) ?? { currentAmount: 0, previousAmount: 0 };
		existing.previousAmount += row.amount;
		map.set(row.catName, existing);
	}

	return [...map.entries()]
		.map(([catName, values]) => ({
			catName,
			currentAmount: values.currentAmount,
			previousAmount: values.previousAmount,
			deltaAmount: values.currentAmount - values.previousAmount,
		}))
		.sort((a, b) => Math.abs(b.deltaAmount) - Math.abs(a.deltaAmount));
}

function percentDelta(current: number, previous: number): number | null {
	if (!Number.isFinite(previous) || previous === 0) return null;
	return ((current - previous) / Math.abs(previous)) * 100;
}

function formatSignedPercent(value: number | null, digits = 1) {
	if (value == null || !Number.isFinite(value)) return "n/a";
	const sign = value >= 0 ? "+" : "";
	return `${sign}${value.toFixed(digits)}%`;
}

function formatSignedNumber(value: number | null, digits = 1, suffix = "") {
	if (value == null || !Number.isFinite(value)) return "n/a";
	const sign = value >= 0 ? "+" : "";
	return `${sign}${value.toFixed(digits)}${suffix}`;
}

function formatSignedAmount(
	value: number,
	fAmount: (amount: number, currency: string) => string,
	currency: string,
) {
	const formatted = fAmount(Math.abs(value), currency);
	if (value > 0) return `+${formatted}`;
	if (value < 0) return `-${formatted}`;
	return formatted;
}

function displayCategoryName(catName: string) {
	return catName === "__uncategorized__" ? "uncategorized" : catName;
}

export function StatsOverviewPanel({
	reportingCurrency,
	queryReportingCurrency,
	mode,
	maxStalenessDays,
	period,
	compare,
	customFrom,
	customTo,
	onPeriodChange,
	onCompareChange,
	onCustomRangeChange,
}: {
	reportingCurrency: string;
	queryReportingCurrency?: string;
	mode: "strict" | "lenient";
	maxStalenessDays: number;
	period: StatsPeriodValue;
	compare: StatsCompareValue;
	customFrom: string;
	customTo: string;
	onPeriodChange: (value: StatsPeriodValue) => void;
	onCompareChange: (value: StatsCompareValue) => void;
	onCustomRangeChange: (from: string, to: string) => void;
}) {
	const { f } = useI18n();
	const nowUtc = useMemo(() => new Date(), []);
	const customRange = useMemo(
		() => normalizeCustomRange(customFrom, customTo),
		[customFrom, customTo],
	);
	const baseRange = useMemo(
		() => resolveBaseRange(period, customRange, nowUtc),
		[period, customRange, nowUtc],
	);
	const compareRange = useMemo(
		() => resolveCompareRange(baseRange, compare),
		[baseRange, compare],
	);
	const comparisonEnabled = compare !== "none" && compareRange != null;
	const baseLabel = useMemo(() => formatRangeLabel(period, baseRange), [period, baseRange]);
	const compareLabel = useMemo(() => formatCompareLabel(compare), [compare]);

	const currentMonthStatsQuery = useMonthStatsQuery({
		from: baseRange.from,
		to: baseRange.to,
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: !!queryReportingCurrency,
	});
	const currentCategoryStatsQuery = useStatsQuery({
		from: baseRange.from,
		to: baseRange.to,
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: !!queryReportingCurrency,
	});
	const currentSummaryQuery = useConvertedStatsSummaryQuery({
		from: baseRange.from,
		to: baseRange.to,
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: !!queryReportingCurrency,
	});

	const compareMonthStatsQuery = useMonthStatsQuery({
		from: compareRange?.from ?? "",
		to: compareRange?.to ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: comparisonEnabled && !!queryReportingCurrency,
	});
	const compareCategoryStatsQuery = useStatsQuery({
		from: compareRange?.from ?? "",
		to: compareRange?.to ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: comparisonEnabled && !!queryReportingCurrency,
	});
	const compareSummaryQuery = useConvertedStatsSummaryQuery({
		from: compareRange?.from ?? "",
		to: compareRange?.to ?? "",
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: comparisonEnabled && !!queryReportingCurrency,
	});

	const currentTotals = useMemo(
		() =>
			toOverviewTotals(
				currentMonthStatsQuery.data ?? [],
				currentCategoryStatsQuery.data ?? [],
			),
		[currentMonthStatsQuery.data, currentCategoryStatsQuery.data],
	);
	const compareTotals = useMemo(
		() =>
			toOverviewTotals(
				compareMonthStatsQuery.data ?? [],
				compareCategoryStatsQuery.data ?? [],
			),
		[compareMonthStatsQuery.data, compareCategoryStatsQuery.data],
	);

	const currentSavingsRate = currentTotals.income > 0
		? currentTotals.net / currentTotals.income
		: null;
	const compareSavingsRate = compareTotals.income > 0
		? compareTotals.net / compareTotals.income
		: null;
	const savingsRateDelta = comparisonEnabled &&
		currentSavingsRate != null &&
		compareSavingsRate != null
		? (currentSavingsRate - compareSavingsRate) * 100
		: null;

	const currentCategoryTotals = useMemo(
		() => summarizeCategoryTotals(currentCategoryStatsQuery.data ?? []),
		[currentCategoryStatsQuery.data],
	);
	const compareCategoryTotals = useMemo(
		() => summarizeCategoryTotals(compareCategoryStatsQuery.data ?? []),
		[compareCategoryStatsQuery.data],
	);

	const expenseDeltas = useMemo(
		() => summarizeCategoryDelta(currentCategoryTotals, compareCategoryTotals, "e"),
		[currentCategoryTotals, compareCategoryTotals],
	);
	const incomeDeltas = useMemo(
		() => summarizeCategoryDelta(currentCategoryTotals, compareCategoryTotals, "i"),
		[currentCategoryTotals, compareCategoryTotals],
	);

	const expenseIncrease = useMemo(
		() =>
			expenseDeltas
				.filter((row) => row.deltaAmount > 0)
				.sort((a, b) => b.deltaAmount - a.deltaAmount)
				.slice(0, 5),
		[expenseDeltas],
	);
	const expenseDecrease = useMemo(
		() =>
			expenseDeltas
				.filter((row) => row.deltaAmount < 0)
				.sort((a, b) => a.deltaAmount - b.deltaAmount)
				.slice(0, 5),
		[expenseDeltas],
	);
	const incomeIncrease = useMemo(
		() =>
			incomeDeltas
				.filter((row) => row.deltaAmount > 0)
				.sort((a, b) => b.deltaAmount - a.deltaAmount)
				.slice(0, 5),
		[incomeDeltas],
	);
	const incomeDecrease = useMemo(
		() =>
			incomeDeltas
				.filter((row) => row.deltaAmount < 0)
				.sort((a, b) => a.deltaAmount - b.deltaAmount)
				.slice(0, 5),
		[incomeDeltas],
	);

	const topCurrentExpense = useMemo(
		() => currentCategoryTotals.filter((row) => row.bucket === "e").slice(0, 5),
		[currentCategoryTotals],
	);
	const topCurrentIncome = useMemo(
		() => currentCategoryTotals.filter((row) => row.bucket === "i").slice(0, 5),
		[currentCategoryTotals],
	);

	const totalCurrentExpense = useMemo(
		() =>
			currentCategoryTotals
				.filter((row) => row.bucket === "e")
				.reduce((sum, row) => sum + row.amount, 0),
		[currentCategoryTotals],
	);
	const totalCurrentIncome = useMemo(
		() =>
			currentCategoryTotals
				.filter((row) => row.bucket === "i")
				.reduce((sum, row) => sum + row.amount, 0),
		[currentCategoryTotals],
	);

	const currentSummary = currentSummaryQuery.data;
	const compareSummary = compareSummaryQuery.data;
	const currentMissingFxRatio = currentSummary?.total_count
		? (currentSummary.total_count - currentSummary.converted_count) /
		currentSummary.total_count
		: 0;
	const compareMissingFxRatio = compareSummary?.total_count
		? (compareSummary.total_count - compareSummary.converted_count) /
		compareSummary.total_count
		: 0;
	const currentCoverageAmountRatio = currentSummary?.coverage_amount_ratio ?? 1;
	const compareCoverageAmountRatio = compareSummary?.coverage_amount_ratio ?? 1;
	const currentUncategorizedRatio = currentTotals.txCount > 0
		? currentTotals.uncategorizedCount / currentTotals.txCount
		: 0;
	const compareUncategorizedRatio = compareTotals.txCount > 0
		? compareTotals.uncategorizedCount / compareTotals.txCount
		: 0;

	const isCurrentLoading =
		currentMonthStatsQuery.isLoading ||
		currentCategoryStatsQuery.isLoading ||
		currentSummaryQuery.isLoading;
	const isCompareLoading = comparisonEnabled &&
		(compareMonthStatsQuery.isLoading ||
			compareCategoryStatsQuery.isLoading ||
			compareSummaryQuery.isLoading);
	const isLoading = isCurrentLoading || isCompareLoading;

	const incomeDeltaAmount = currentTotals.income - compareTotals.income;
	const expenseDeltaAmount = currentTotals.expense - compareTotals.expense;
	const netDeltaAmount = currentTotals.net - compareTotals.net;

	return (
		<div className="space-y-4">
			<div className="border border-gray-a4 p-3 space-y-3">
				<div>
					<div className="mb-1 text-xs text-gray-10 font-mono">period</div>
					<div className="inline-flex flex-wrap border border-gray-a4 bg-gray-1 p-1 text-xs font-mono">
						{([
							["this-month", "this month"],
							["last-month", "last month"],
							["this-year", "this year"],
							["last-year", "last year"],
						] as const).map(([value, label]) => {
							const isActive = value === period;
							return (
								<button
									key={value}
									type="button"
									onClick={() => onPeriodChange(value)}
									className={
										"px-2 py-1 transition-colors " +
										(isActive
											? "bg-gray-a3 text-gray-12"
											: "text-gray-10 hover:bg-gray-a2")
									}
								>
									{label}
								</button>
							);
						})}
					</div>
				</div>

				<div className="text-xs font-mono w-max">
					<DateRangePickerInput
						size="sm"
						value={baseRange}
						showWeekNumbers
						onChange={(nextRange) => onCustomRangeChange(nextRange.from, nextRange.to)}
					/>
				</div>

				<div>
					<div className="mb-1 text-xs text-gray-10 font-mono">compare to</div>
					<div className="inline-flex flex-wrap border border-gray-a4 bg-gray-1 p-1 text-xs font-mono">
						{([
							["previous", "previous period"],
							["year-over-year", "same period last year"],
							["none", "none"],
						] as const).map(([value, label]) => {
							const isActive = value === compare;
							return (
								<button
									key={value}
									type="button"
									onClick={() => onCompareChange(value)}
									className={
										"px-2 py-1 transition-colors " +
										(isActive
											? "bg-gray-a3 text-gray-12"
											: "text-gray-10 hover:bg-gray-a2")
									}
								>
									{label}
								</button>
							);
						})}
					</div>
				</div>

				{comparisonEnabled && compareRange && (
					<div className="mt-1 text-gray-a12">{f.longDate.format(new Date(compareRange.from))} to {f.longDate.format(new Date(compareRange.to))}</div>
				)}
			</div>


			{isLoading && <p className="text-xs text-gray-10">loading stats 2...</p>}
			{currentMonthStatsQuery.isError && (
				<pre className="text-xs text-red-11 whitespace-pre-wrap">
					{String(currentMonthStatsQuery.error)}
				</pre>
			)}
			{currentCategoryStatsQuery.isError && (
				<pre className="text-xs text-red-11 whitespace-pre-wrap">
					{String(currentCategoryStatsQuery.error)}
				</pre>
			)}
			{currentSummaryQuery.isError && (
				<pre className="text-xs text-red-11 whitespace-pre-wrap">
					{String(currentSummaryQuery.error)}
				</pre>
			)}
			{comparisonEnabled && compareMonthStatsQuery.isError && (
				<pre className="text-xs text-red-11 whitespace-pre-wrap">
					{String(compareMonthStatsQuery.error)}
				</pre>
			)}
			{comparisonEnabled && compareCategoryStatsQuery.isError && (
				<pre className="text-xs text-red-11 whitespace-pre-wrap">
					{String(compareCategoryStatsQuery.error)}
				</pre>
			)}
			{comparisonEnabled && compareSummaryQuery.isError && (
				<pre className="text-xs text-red-11 whitespace-pre-wrap">
					{String(compareSummaryQuery.error)}
				</pre>
			)}

			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				<StatsMetricCard
					label="income"
					value={f.amount(currentTotals.income, reportingCurrency)}
					subvalue={`${currentTotals.txCount} tx`}
					delta={comparisonEnabled
						? `${formatSignedAmount(incomeDeltaAmount, f.amount, reportingCurrency)} (${formatSignedPercent(percentDelta(currentTotals.income, compareTotals.income))})`
						: undefined}
				/>
				<StatsMetricCard
					label="expense"
					value={f.amount(currentTotals.expense, reportingCurrency)}
					subvalue={`${currentTotals.txCount} tx`}
					delta={comparisonEnabled
						? `${formatSignedAmount(expenseDeltaAmount, f.amount, reportingCurrency)} (${formatSignedPercent(percentDelta(currentTotals.expense, compareTotals.expense))})`
						: undefined}
				/>
				<StatsMetricCard
					label="net"
					value={f.amount(currentTotals.net, reportingCurrency)}
					subvalue={`${currentTotals.unconvertedCount} unconverted tx`}
					delta={comparisonEnabled
						? `${formatSignedAmount(netDeltaAmount, f.amount, reportingCurrency)} (${formatSignedPercent(percentDelta(currentTotals.net, compareTotals.net))})`
						: undefined}
				/>
				<StatsMetricCard
					label="savings rate"
					value={currentSavingsRate == null ? "n/a" : `${(currentSavingsRate * 100).toFixed(1)}%`}
					subvalue={`${f.amount(currentTotals.net, reportingCurrency)} net`}
					delta={comparisonEnabled
						? `${formatSignedNumber(savingsRateDelta, 1, "pp")} vs ${compareLabel}`
						: undefined}
				/>
			</div>

			<div className="grid gap-3 md:grid-cols-3">
				<StatsMetricCard
					label="uncategorized tx"
					value={`${(currentUncategorizedRatio * 100).toFixed(1)}%`}
					subvalue={`${currentTotals.uncategorizedCount}/${currentTotals.txCount} tx`}
					delta={comparisonEnabled
						? `${formatSignedNumber((currentUncategorizedRatio - compareUncategorizedRatio) * 100, 1, "pp")} vs ${compareLabel}`
						: undefined}
				/>
				<StatsMetricCard
					label="missing FX rate"
					value={`${(currentMissingFxRatio * 100).toFixed(1)}%`}
					subvalue={`${(currentSummary?.total_count ?? 0) - (currentSummary?.converted_count ?? 0)}/${currentSummary?.total_count ?? 0} tx`}
					delta={comparisonEnabled
						? `${formatSignedNumber((currentMissingFxRatio - compareMissingFxRatio) * 100, 1, "pp")} vs ${compareLabel}`
						: undefined}
				/>
				<StatsMetricCard
					label="amount coverage"
					value={`${(currentCoverageAmountRatio * 100).toFixed(1)}%`}
					subvalue={`mode ${mode}, stale ${maxStalenessDays}d`}
					delta={comparisonEnabled
						? `${formatSignedNumber((currentCoverageAmountRatio - compareCoverageAmountRatio) * 100, 1, "pp")} vs ${compareLabel}`
						: undefined}
				/>
			</div>

			{comparisonEnabled ? (
				<div className="grid gap-4 lg:grid-cols-2">
					<CategoryDeltaPanel
						title="expense category deltas"
						increases={expenseIncrease}
						decreases={expenseDecrease}
						reportingCurrency={reportingCurrency}
					/>
					<CategoryDeltaPanel
						title="income category deltas"
						increases={incomeIncrease}
						decreases={incomeDecrease}
						reportingCurrency={reportingCurrency}
					/>
				</div>
			) : (
				<div className="grid gap-4 lg:grid-cols-2">
					<CurrentCategoryPanel
						title="top expense categories"
						rows={topCurrentExpense}
						totalAmount={totalCurrentExpense}
						reportingCurrency={reportingCurrency}
					/>
					<CurrentCategoryPanel
						title="top income categories"
						rows={topCurrentIncome}
						totalAmount={totalCurrentIncome}
						reportingCurrency={reportingCurrency}
					/>
				</div>
			)}
		</div>
	);
}

function StatsMetricCard({
	label,
	value,
	subvalue,
	delta,
}: {
	label: string;
	value: string;
	subvalue: string;
	delta?: string;
}) {
	return (
		<div className="border border-gray-a4 p-3">
			<div className="text-[11px] font-mono text-gray-10">{label}</div>
			<div className="mt-1 text-sm text-gray-12">{value}</div>
			<div className="mt-1 text-[11px] font-mono text-gray-10">{subvalue}</div>
			{delta && <div className="mt-1 text-[11px] font-mono text-gray-10">{delta}</div>}
		</div>
	);
}

function CategoryDeltaPanel({
	title,
	increases,
	decreases,
	reportingCurrency,
}: {
	title: string;
	increases: CategoryDelta[];
	decreases: CategoryDelta[];
	reportingCurrency: string;
}) {
	const { f } = useI18n();

	return (
		<div className="border border-gray-a4">
			<div className="border-b border-gray-a4 px-3 py-2 text-xs font-mono text-gray-10">{title}</div>
			<div className="p-3 grid gap-4 md:grid-cols-2">
				<div>
					<div className="mb-2 text-[11px] font-mono text-gray-10">biggest increases</div>
					<div className="space-y-2">
						{increases.length === 0 && <p className="text-xs text-gray-10">none</p>}
						{increases.map((row) => (
							<div key={`inc:${row.catName}`} className="text-xs font-mono">
								<div className="flex items-center justify-between gap-2">
									<span className="truncate text-gray-12">{displayCategoryName(row.catName)}</span>
									<span className="text-gray-12">{f.amount(row.currentAmount, reportingCurrency)}</span>
								</div>
								<div className="text-[11px] text-gray-10">
									{formatSignedAmount(row.deltaAmount, f.amount, reportingCurrency)}
								</div>
							</div>
						))}
					</div>
				</div>
				<div>
					<div className="mb-2 text-[11px] font-mono text-gray-10">biggest decreases</div>
					<div className="space-y-2">
						{decreases.length === 0 && <p className="text-xs text-gray-10">none</p>}
						{decreases.map((row) => (
							<div key={`dec:${row.catName}`} className="text-xs font-mono">
								<div className="flex items-center justify-between gap-2">
									<span className="truncate text-gray-12">{displayCategoryName(row.catName)}</span>
									<span className="text-gray-12">{f.amount(row.currentAmount, reportingCurrency)}</span>
								</div>
								<div className="text-[11px] text-gray-10">
									{formatSignedAmount(row.deltaAmount, f.amount, reportingCurrency)}
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

function CurrentCategoryPanel({
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
