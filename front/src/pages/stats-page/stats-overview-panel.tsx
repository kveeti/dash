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
	type StatsAmountMode,
	type StatsCompareValue,
	type StatsPeriodValue,
} from "./stats-page-types";
import type { TransactionFilters } from "../../lib/queries/query-keys";
import { FastLink } from "../../components/link";
import { IconChevronLeft } from "../../components/icons/chevron-left";
import { IconChevronRight } from "../../components/icons/chevron-right";
import { Spinner } from "../../components/spinner";

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

function addMonths(date: Date, months: number) {
	const targetMonth = date.getUTCMonth() + months;
	const targetFirst = new Date(Date.UTC(date.getUTCFullYear(), targetMonth, 1));
	const lastDay = endOfMonth(targetFirst).getUTCDate();
	return new Date(
		Date.UTC(
			targetFirst.getUTCFullYear(),
			targetFirst.getUTCMonth(),
			Math.min(date.getUTCDate(), lastDay),
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

function detectWholeMonth(range: DateRange): { year: number; month: number } | null {
	const fromDate = parseIsoDate(range.from);
	const toDate = parseIsoDate(range.to);
	if (!fromDate || !toDate) return null;
	if (fromDate.getUTCDate() !== 1) return null;
	if (fromDate.getUTCFullYear() !== toDate.getUTCFullYear()) return null;
	if (fromDate.getUTCMonth() !== toDate.getUTCMonth()) return null;
	if (toDate.getUTCDate() !== endOfMonth(fromDate).getUTCDate()) return null;
	return { year: fromDate.getUTCFullYear(), month: fromDate.getUTCMonth() };
}

function detectWholeYear(range: DateRange): { year: number } | null {
	const fromDate = parseIsoDate(range.from);
	const toDate = parseIsoDate(range.to);
	if (!fromDate || !toDate) return null;
	if (fromDate.getUTCMonth() !== 0 || fromDate.getUTCDate() !== 1) return null;
	if (toDate.getUTCMonth() !== 11 || toDate.getUTCDate() !== 31) return null;
	if (fromDate.getUTCFullYear() !== toDate.getUTCFullYear()) return null;
	return { year: fromDate.getUTCFullYear() };
}

function rangeDayCount(range: DateRange) {
	const fromDate = parseIsoDate(range.from);
	const toDate = parseIsoDate(range.to);
	if (!fromDate || !toDate || fromDate > toDate) return 1;
	return Math.max(
		1,
		Math.floor(
			(toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000),
		) + 1,
	);
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
	const lastMonthRef = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
	);
	if (period === "this-month") {
		return { from: formatIsoDate(monthStart), to: formatIsoDate(now) };
	}
	if (period === "last-month") {
		return {
			from: formatIsoDate(startOfMonth(lastMonthRef)),
			to: formatIsoDate(endOfMonth(lastMonthRef)),
		};
	}
	if (period === "last-7-days") {
		return { from: formatIsoDate(addDays(now, -6)), to: formatIsoDate(now) };
	}
	if (period === "last-30-days") {
		return { from: formatIsoDate(addDays(now, -29)), to: formatIsoDate(now) };
	}
	if (period === "last-90-days") {
		return { from: formatIsoDate(addDays(now, -89)), to: formatIsoDate(now) };
	}
	if (period === "last-12-months") {
		return {
			from: formatIsoDate(addDays(addMonths(now, -12), 1)),
			to: formatIsoDate(now),
		};
	}
	if (period === "this-year") {
		return {
			from: formatIsoDate(startOfYear(now)),
			to: formatIsoDate(now),
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

	const wholeYear = detectWholeYear(baseRange);
	if (wholeYear) {
		const y = wholeYear.year - 1;
		return { from: `${y}-01-01`, to: `${y}-12-31` };
	}
	const wholeMonth = detectWholeMonth(baseRange);
	if (wholeMonth) {
		const prevFirst = new Date(Date.UTC(wholeMonth.year, wholeMonth.month - 1, 1));
		const lastDay = endOfMonth(prevFirst).getUTCDate();
		return {
			from: formatIsoDate(prevFirst),
			to: formatIsoDate(new Date(Date.UTC(prevFirst.getUTCFullYear(), prevFirst.getUTCMonth(), lastDay))),
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

function valueForAmountMode(value: number, mode: StatsAmountMode, dayCount: number) {
	if (mode === "per-day") return value / dayCount;
	return value;
}

function valueCategoryDeltaForAmountMode(
	row: CategoryDelta,
	mode: StatsAmountMode,
	currentDayCount: number,
	previousDayCount: number,
): CategoryDelta {
	const currentAmount = valueForAmountMode(row.currentAmount, mode, currentDayCount);
	const previousAmount = valueForAmountMode(row.previousAmount, mode, previousDayCount);
	return {
		...row,
		currentAmount,
		previousAmount,
		deltaAmount: currentAmount - previousAmount,
	};
}

function amountModeSuffix(mode: StatsAmountMode) {
	return mode === "per-day" ? "/day" : "";
}

function displayCategoryName(catName: string) {
	return catName === "__uncategorized__" ? "uncategorized" : catName;
}

function directionOf(value: number): "up" | "down" | "flat" {
	if (value > 0) return "up";
	if (value < 0) return "down";
	return "flat";
}

export function StatsOverviewPanel({
	reportingCurrency,
	queryReportingCurrency,
	mode,
	maxStalenessDays,
	search,
	filters,
	scopeParams,
	period,
	compare,
	amountMode,
	customFrom,
	customTo,
	onPeriodChange,
	onCompareChange,
	onAmountModeChange,
	onCustomRangeChange,
}: {
	reportingCurrency: string;
	queryReportingCurrency?: string;
	mode: "strict" | "lenient";
	maxStalenessDays: number;
	search?: string;
	filters?: TransactionFilters;
	scopeParams: Record<string, string | undefined>;
	period: StatsPeriodValue;
	compare: StatsCompareValue;
	amountMode: StatsAmountMode;
	customFrom: string;
	customTo: string;
	onPeriodChange: (value: StatsPeriodValue) => void;
	onCompareChange: (value: StatsCompareValue) => void;
	onAmountModeChange: (value: StatsAmountMode) => void;
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
	const baseDayCount = useMemo(() => rangeDayCount(baseRange), [baseRange]);
	const compareDayCount = useMemo(
		() => (compareRange ? rangeDayCount(compareRange) : 1),
		[compareRange],
	);
	const comparisonEnabled = compare !== "none" && compareRange != null;
	const compareLabel = useMemo(() => formatCompareLabel(compare), [compare]);
	const scopedTransactionHref = useMemo(
		() =>
			buildPath("/txs", {
				...scopeParams,
				from: baseRange.from,
				to: baseRange.to,
			}),
		[baseRange, scopeParams],
	);
	const scopedUncategorizedHref = useMemo(
		() =>
			buildPath("/txs", {
				...scopeParams,
				cat: undefined,
				uncat: "1",
				from: baseRange.from,
				to: baseRange.to,
			}),
		[baseRange, scopeParams],
	);
	const shiftRange = (direction: -1 | 1) => {
		const wholeYear = detectWholeYear(baseRange);
		if (wholeYear) {
			const y = wholeYear.year + direction;
			onCustomRangeChange(`${y}-01-01`, `${y}-12-31`);
			return;
		}
		const wholeMonth = detectWholeMonth(baseRange);
		if (wholeMonth) {
			const nextFirst = new Date(Date.UTC(wholeMonth.year, wholeMonth.month + direction, 1));
			const lastDay = endOfMonth(nextFirst).getUTCDate();
			onCustomRangeChange(
				formatIsoDate(nextFirst),
				formatIsoDate(new Date(Date.UTC(nextFirst.getUTCFullYear(), nextFirst.getUTCMonth(), lastDay))),
			);
			return;
		}
		const fromDate = parseIsoDate(baseRange.from);
		const toDate = parseIsoDate(baseRange.to);
		if (!fromDate || !toDate) return;
		const spanDays = rangeDayCount(baseRange);
		onCustomRangeChange(
			formatIsoDate(addDays(fromDate, direction * spanDays)),
			formatIsoDate(addDays(toDate, direction * spanDays)),
		);
	};

	const currentMonthStatsQuery = useMonthStatsQuery({
		from: baseRange.from,
		to: baseRange.to,
		search,
		filters,
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: !!queryReportingCurrency,
	});
	const currentCategoryStatsQuery = useStatsQuery({
		from: baseRange.from,
		to: baseRange.to,
		search,
		filters,
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: !!queryReportingCurrency,
	});
	const currentSummaryQuery = useConvertedStatsSummaryQuery({
		from: baseRange.from,
		to: baseRange.to,
		search,
		filters,
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: !!queryReportingCurrency,
	});

	const compareMonthStatsQuery = useMonthStatsQuery({
		from: compareRange?.from ?? "",
		to: compareRange?.to ?? "",
		search,
		filters,
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: comparisonEnabled && !!queryReportingCurrency,
	});
	const compareCategoryStatsQuery = useStatsQuery({
		from: compareRange?.from ?? "",
		to: compareRange?.to ?? "",
		search,
		filters,
		reportingCurrency: queryReportingCurrency,
		maxStalenessDays,
		mode,
		enabled: comparisonEnabled && !!queryReportingCurrency,
	});
	const compareSummaryQuery = useConvertedStatsSummaryQuery({
		from: compareRange?.from ?? "",
		to: compareRange?.to ?? "",
		search,
		filters,
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
	const displayExpenseDeltas = useMemo(
		() =>
			expenseDeltas
				.map((row) =>
					valueCategoryDeltaForAmountMode(
						row,
						amountMode,
						baseDayCount,
						compareDayCount,
					)
				)
				.sort((a, b) => Math.abs(b.deltaAmount) - Math.abs(a.deltaAmount)),
		[amountMode, baseDayCount, compareDayCount, expenseDeltas],
	);
	const displayIncomeDeltas = useMemo(
		() =>
			incomeDeltas
				.map((row) =>
					valueCategoryDeltaForAmountMode(
						row,
						amountMode,
						baseDayCount,
						compareDayCount,
					)
				)
				.sort((a, b) => Math.abs(b.deltaAmount) - Math.abs(a.deltaAmount)),
		[amountMode, baseDayCount, compareDayCount, incomeDeltas],
	);

	const expenseIncrease = useMemo(
		() =>
			displayExpenseDeltas
				.filter((row) => row.deltaAmount > 0)
				.sort((a, b) => b.deltaAmount - a.deltaAmount)
				.slice(0, 5),
		[displayExpenseDeltas],
	);
	const expenseDecrease = useMemo(
		() =>
			displayExpenseDeltas
				.filter((row) => row.deltaAmount < 0)
				.sort((a, b) => a.deltaAmount - b.deltaAmount)
				.slice(0, 5),
		[displayExpenseDeltas],
	);
	const incomeIncrease = useMemo(
		() =>
			displayIncomeDeltas
				.filter((row) => row.deltaAmount > 0)
				.sort((a, b) => b.deltaAmount - a.deltaAmount)
				.slice(0, 5),
		[displayIncomeDeltas],
	);
	const incomeDecrease = useMemo(
		() =>
			displayIncomeDeltas
				.filter((row) => row.deltaAmount < 0)
				.sort((a, b) => a.deltaAmount - b.deltaAmount)
				.slice(0, 5),
		[displayIncomeDeltas],
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
	const currentUncategorizedRatio = currentTotals.txCount > 0
		? currentTotals.uncategorizedCount / currentTotals.txCount
		: 0;
	const compareUncategorizedRatio = compareTotals.txCount > 0
		? compareTotals.uncategorizedCount / compareTotals.txCount
		: 0;

	const isFetching =
		currentMonthStatsQuery.isFetching ||
		currentCategoryStatsQuery.isFetching ||
		currentSummaryQuery.isFetching ||
		(comparisonEnabled &&
			(compareMonthStatsQuery.isFetching ||
				compareCategoryStatsQuery.isFetching ||
				compareSummaryQuery.isFetching));
	const hasAnyData =
		currentMonthStatsQuery.data != null ||
		currentCategoryStatsQuery.data != null ||
		currentSummaryQuery.data != null;

	const currentIncomeValue = valueForAmountMode(currentTotals.income, amountMode, baseDayCount);
	const currentExpenseValue = valueForAmountMode(currentTotals.expense, amountMode, baseDayCount);
	const currentNetValue = valueForAmountMode(currentTotals.net, amountMode, baseDayCount);
	const compareIncomeValue = valueForAmountMode(compareTotals.income, amountMode, compareDayCount);
	const compareExpenseValue = valueForAmountMode(compareTotals.expense, amountMode, compareDayCount);
	const compareNetValue = valueForAmountMode(compareTotals.net, amountMode, compareDayCount);
	const incomeDeltaValue = currentIncomeValue - compareIncomeValue;
	const expenseDeltaValue = currentExpenseValue - compareExpenseValue;
	const netDeltaValue = currentNetValue - compareNetValue;
	const suffix = amountModeSuffix(amountMode);

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<div className="bg-gray-3 px-3 py-1.5 flex items-center justify-between gap-3 text-xs font-medium">
					<div className="flex items-baseline gap-2 min-w-0">
						<span className="text-gray-10 font-normal font-mono truncate">
							{f.longDate.format(new Date(baseRange.from))} – {f.longDate.format(new Date(baseRange.to))} · {baseDayCount}d
						</span>
					</div>
					<div className="flex items-center gap-2 shrink-0">
						<span
							aria-hidden={!isFetching}
							className={
								"text-gray-10 transition-opacity " +
								(isFetching ? "opacity-100" : "opacity-0")
							}
						>
							<Spinner />
						</span>
						<FastLink
							href={scopedTransactionHref}
							className="text-xs font-mono font-normal text-gray-11 hover:text-gray-12 hover:underline"
						>
							view transactions →
						</FastLink>
					</div>
				</div>

				<div className="px-3 space-y-2">
					<div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
						{([
							["this-month", "this month"],
							["last-month", "last month"],
							["last-7-days", "7d"],
							["last-30-days", "30d"],
							["last-90-days", "90d"],
							["last-12-months", "12mo"],
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
										"px-2 py-0.5 transition-colors " +
										(isActive
											? "bg-gray-a4 text-gray-12"
											: "text-gray-11 hover:bg-gray-a3")
									}
								>
									{label}
								</button>
							);
						})}
					</div>

					<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
						<div className="flex items-center gap-1 min-w-0">
							<div className="inline-flex text-xs font-mono shrink-0">
								<button
									type="button"
									aria-label="previous period"
									title="previous period"
									onClick={() => shiftRange(-1)}
									className="grid size-7 place-items-center text-gray-11 hover:bg-gray-a3 hover:text-gray-12"
								>
									<IconChevronLeft />
								</button>
								<button
									type="button"
									aria-label="next period"
									title="next period"
									onClick={() => shiftRange(1)}
									className="grid size-7 place-items-center text-gray-11 hover:bg-gray-a3 hover:text-gray-12"
								>
									<IconChevronRight />
								</button>
							</div>
							<div className="text-xs font-mono flex-1 min-w-0 sm:w-max sm:flex-none">
								<DateRangePickerInput
									size="sm"
									value={baseRange}
									showWeekNumbers
									onChange={(nextRange) => onCustomRangeChange(nextRange.from, nextRange.to)}
								/>
							</div>
						</div>

						<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-mono sm:ml-auto">
							<div className="inline-flex items-center gap-1.5">
								<span className="text-gray-10">amounts</span>
								{([
									["total", "total"],
									["per-day", "/day"],
								] as const).map(([value, label]) => {
									const isActive = value === amountMode;
									return (
										<button
											key={value}
											type="button"
											onClick={() => onAmountModeChange(value)}
											className={
												"px-1.5 py-0.5 transition-colors " +
												(isActive
													? "bg-gray-a4 text-gray-12"
													: "text-gray-11 hover:bg-gray-a3")
											}
										>
											{label}
										</button>
									);
								})}
							</div>
							<div className="inline-flex items-center gap-1.5">
								<span className="text-gray-10">vs</span>
								{([
									["previous", "prev"],
									["year-over-year", "yoy"],
									["none", "off"],
								] as const).map(([value, label]) => {
									const isActive = value === compare;
									return (
										<button
											key={value}
											type="button"
											onClick={() => onCompareChange(value)}
											className={
												"px-1.5 py-0.5 transition-colors " +
												(isActive
													? "bg-gray-a4 text-gray-12"
													: "text-gray-11 hover:bg-gray-a3")
											}
										>
											{label}
										</button>
									);
								})}
							</div>
						</div>
					</div>

					{comparisonEnabled && compareRange && (
						<div className="text-[11px] font-mono text-gray-10">
							compare to <span className="text-gray-11">{compareLabel}</span>
							<span className="ml-1">({f.longDate.format(new Date(compareRange.from))} – {f.longDate.format(new Date(compareRange.to))})</span>
						</div>
					)}
				</div>
			</div>


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

			<div
				className={
					"space-y-4 transition-opacity duration-200 " +
					(isFetching && hasAnyData ? "opacity-60" : "")
				}
			>
			<div className="grid gap-px bg-gray-3 md:grid-cols-2 xl:grid-cols-4">
				<StatsMetricCard
					label="income"
					tone="income"
					value={`${f.amount(currentIncomeValue, reportingCurrency)}${suffix}`}
					subvalue={`${currentTotals.txCount} tx · ${baseDayCount}d`}
					delta={comparisonEnabled
						? `${formatSignedAmount(incomeDeltaValue, f.amount, reportingCurrency)}${suffix} (${formatSignedPercent(percentDelta(currentIncomeValue, compareIncomeValue))})`
						: undefined}
					deltaDirection={comparisonEnabled ? directionOf(incomeDeltaValue) : undefined}
				/>
				<StatsMetricCard
					label="expense"
					tone="expense"
					value={`${f.amount(currentExpenseValue, reportingCurrency)}${suffix}`}
					subvalue={`${currentTotals.txCount} tx · ${baseDayCount}d`}
					delta={comparisonEnabled
						? `${formatSignedAmount(expenseDeltaValue, f.amount, reportingCurrency)}${suffix} (${formatSignedPercent(percentDelta(currentExpenseValue, compareExpenseValue))})`
						: undefined}
					deltaDirection={comparisonEnabled ? directionOf(expenseDeltaValue) : undefined}
				/>
				<StatsMetricCard
					label="net"
					tone="neutral"
					value={`${f.amount(currentNetValue, reportingCurrency)}${suffix}`}
					valueAccent={currentNetValue > 0 ? "good" : undefined}
					subvalue={`${currentTotals.unconvertedCount} unconverted tx · ${baseDayCount}d`}
					delta={comparisonEnabled
						? `${formatSignedAmount(netDeltaValue, f.amount, reportingCurrency)}${suffix} (${formatSignedPercent(percentDelta(currentNetValue, compareNetValue))})`
						: undefined}
					deltaDirection={comparisonEnabled ? directionOf(netDeltaValue) : undefined}
				/>
				<StatsMetricCard
					label="savings rate"
					tone="neutral"
					value={currentSavingsRate == null ? "n/a" : `${(currentSavingsRate * 100).toFixed(1)}%`}
					subvalue={`${f.amount(currentNetValue, reportingCurrency)}${suffix} net`}
					delta={comparisonEnabled && savingsRateDelta != null
						? `${formatSignedNumber(savingsRateDelta, 1, "pp")} vs ${compareLabel}`
						: undefined}
					deltaDirection={comparisonEnabled && savingsRateDelta != null ? directionOf(savingsRateDelta) : undefined}
				/>
			</div>

			<div className="flex flex-wrap gap-x-6 gap-y-1 px-3 py-2 bg-gray-2 text-[11px] font-mono text-gray-10">
				<FastLink
					href={scopedUncategorizedHref}
					className="hover:underline hover:[&_*]:text-gray-12"
				>
					<span className="text-gray-11">{(currentUncategorizedRatio * 100).toFixed(1)}%</span>
					{" "}<span className="text-gray-10">uncategorized</span>
					{" "}<span className="text-gray-10">({currentTotals.uncategorizedCount}/{currentTotals.txCount})</span>
					{comparisonEnabled && (
						<span className="ml-1 text-gray-10">
							{formatSignedNumber((currentUncategorizedRatio - compareUncategorizedRatio) * 100, 1, "pp")} vs {compareLabel}
						</span>
					)}
				</FastLink>
				<span>
					<span className="text-gray-11">{(currentMissingFxRatio * 100).toFixed(1)}%</span>
					{" "}missing FX
					{" "}<span className="text-gray-10">({(currentSummary?.total_count ?? 0) - (currentSummary?.converted_count ?? 0)}/{currentSummary?.total_count ?? 0})</span>
					{comparisonEnabled && (
						<span className="ml-1 text-gray-10">
							{formatSignedNumber((currentMissingFxRatio - compareMissingFxRatio) * 100, 1, "pp")} vs {compareLabel}
						</span>
					)}
				</span>
				<span>
					<span className="text-gray-11">{(currentCoverageAmountRatio * 100).toFixed(1)}%</span>
					{" "}amount coverage
					{" "}<span className="text-gray-10">({mode}, stale {maxStalenessDays}d)</span>
				</span>
			</div>

			{comparisonEnabled ? (
				<div className="grid gap-3 lg:grid-cols-2">
					<CategoryDeltaPanel
						title="expense category deltas"
						increases={expenseIncrease}
						decreases={expenseDecrease}
						reportingCurrency={reportingCurrency}
						amountSuffix={suffix}
						bucket="e"
					/>
					<CategoryDeltaPanel
						title="income category deltas"
						increases={incomeIncrease}
						decreases={incomeDecrease}
						reportingCurrency={reportingCurrency}
						amountSuffix={suffix}
						bucket="i"
					/>
				</div>
			) : (
				<div className="grid gap-3 lg:grid-cols-2">
					<CurrentCategoryPanel
						title="top expense categories"
						rows={topCurrentExpense}
						totalAmount={totalCurrentExpense}
						reportingCurrency={reportingCurrency}
						amountMode={amountMode}
						dayCount={baseDayCount}
						amountSuffix={suffix}
					/>
					<CurrentCategoryPanel
						title="top income categories"
						rows={topCurrentIncome}
						totalAmount={totalCurrentIncome}
						reportingCurrency={reportingCurrency}
						amountMode={amountMode}
						dayCount={baseDayCount}
						amountSuffix={suffix}
					/>
				</div>
			)}
			</div>
		</div>
	);
}

function buildPath(path: string, params: Record<string, string | undefined>) {
	const next = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value) next.set(key, value);
	}
	const qs = next.toString();
	return qs ? `${path}?${qs}` : path;
}

function StatsMetricCard({
	label,
	value,
	subvalue,
	delta,
	deltaDirection,
	tone,
	valueAccent,
}: {
	label: string;
	value: string;
	subvalue: string;
	delta?: string;
	deltaDirection?: "up" | "down" | "flat" | null;
	tone?: "income" | "expense" | "neutral";
	valueAccent?: "good";
}) {
	const valueColor = valueAccent === "good" ? "text-green-11" : "text-gray-12";
	const arrowColor = deltaDirection === "up"
		? tone === "expense" ? "text-orange-11" : "text-green-11"
		: deltaDirection === "down"
			? tone === "expense" ? "text-green-11" : "text-orange-11"
			: "text-gray-10";
	const arrow = deltaDirection === "up" ? "↑" : deltaDirection === "down" ? "↓" : "·";
	return (
		<div className="bg-gray-2 px-3 py-2.5">
			<div className="text-[11px] font-mono text-gray-10">{label}</div>
			<div className={`mt-1 text-base font-medium ${valueColor}`}>{value}</div>
			<div className="mt-0.5 text-[11px] font-mono text-gray-10">{subvalue}</div>
			{delta && (
				<div className="mt-1 text-[11px] font-mono text-gray-10">
					{deltaDirection ? <span className={`mr-0.5 ${arrowColor}`}>{arrow}</span> : null}
					{delta}
				</div>
			)}
		</div>
	);
}

function CategoryDeltaPanel({
	title,
	increases,
	decreases,
	reportingCurrency,
	amountSuffix,
	bucket,
}: {
	title: string;
	increases: CategoryDelta[];
	decreases: CategoryDelta[];
	reportingCurrency: string;
	amountSuffix: string;
	bucket: "i" | "e";
}) {
	return (
		<div>
			<div className="bg-gray-3 px-3 py-1.5 text-xs font-medium text-gray-12">{title}</div>
			<div className="grid gap-x-6 gap-y-3 px-3 py-2 sm:grid-cols-2">
				<DeltaColumn
					direction="up"
					rows={increases}
					reportingCurrency={reportingCurrency}
					amountSuffix={amountSuffix}
					bucket={bucket}
				/>
				<DeltaColumn
					direction="down"
					rows={decreases}
					reportingCurrency={reportingCurrency}
					amountSuffix={amountSuffix}
					bucket={bucket}
				/>
			</div>
		</div>
	);
}

function DeltaColumn({
	direction,
	rows,
	reportingCurrency,
	amountSuffix,
	bucket,
}: {
	direction: "up" | "down";
	rows: CategoryDelta[];
	reportingCurrency: string;
	amountSuffix: string;
	bucket: "i" | "e";
}) {
	const { f } = useI18n();
	const baseColor = "text-gray-12";
	const headingColor = bucket === "e"
		? direction === "up" ? "text-orange-11" : "text-green-11"
		: direction === "up" ? "text-green-11" : "text-orange-11";
	const arrow = direction === "up" ? "↑" : "↓";
	const label = direction === "up" ? "increases" : "decreases";
	return (
		<div>
			<div className="mb-1 text-xs text-gray-11">
				<span className={headingColor}>{arrow}</span> {label}
			</div>
			<div>
				{rows.length === 0 && <p className="text-xs text-gray-10">none</p>}
				{rows.map((row) => {
					const isUp = row.deltaAmount > 0;
					const deltaColor = bucket === "e"
						? isUp ? "text-orange-11" : "text-green-11"
						: isUp ? "text-green-11" : "text-orange-11";
					return (
						<div
							key={`${bucket}:${row.catName}`}
							className="flex items-baseline justify-between gap-2 py-1 text-xs font-mono"
						>
							<span className="truncate text-gray-12">{displayCategoryName(row.catName)}</span>
							<div className="shrink-0 text-right">
								<div className={baseColor}>
									{f.amount(row.currentAmount, reportingCurrency)}{amountSuffix}
								</div>
								<div className="text-[11px] text-gray-10">
									<span className={deltaColor}>{isUp ? "↑" : "↓"}</span>
									{" "}
									{formatSignedAmount(row.deltaAmount, f.amount, reportingCurrency)}{amountSuffix}
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function CurrentCategoryPanel({
	title,
	rows,
	totalAmount,
	reportingCurrency,
	amountMode,
	dayCount,
	amountSuffix,
}: {
	title: string;
	rows: CategoryTotal[];
	totalAmount: number;
	reportingCurrency: string;
	amountMode: StatsAmountMode;
	dayCount: number;
	amountSuffix: string;
}) {
	const { f } = useI18n();

	return (
		<div>
			<div className="bg-gray-3 px-3 py-1.5 text-xs font-medium text-gray-12">{title}</div>
			<div className="px-3 py-2">
				{rows.length === 0 && <p className="text-xs text-gray-10">no data</p>}
				{rows.map((row) => {
					const share = totalAmount > 0 ? row.amount / totalAmount : 0;
					const displayAmount = valueForAmountMode(row.amount, amountMode, dayCount);
					return (
						<div
							key={`${row.bucket}:${row.catName}`}
							className="-mx-1 px-1 py-1.5 hover:bg-gray-a3"
						>
							<div className="flex items-baseline justify-between gap-2 text-xs font-mono">
								<span className="truncate text-gray-12">{displayCategoryName(row.catName)}</span>
								<span className="shrink-0 text-gray-12">
									{f.amount(displayAmount, reportingCurrency)}{amountSuffix}
								</span>
							</div>
							<div className="mt-1 flex items-center gap-2">
								<div className="h-1 flex-1 bg-gray-a3">
									<div
										className="h-full bg-gray-9"
										style={{ width: `${Math.max(share * 100, share > 0 ? 3 : 0)}%` }}
									/>
								</div>
								<div className="shrink-0 text-[11px] font-mono text-gray-10 tabular-nums">
									{(share * 100).toFixed(0)}% · {row.txCount} tx
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
