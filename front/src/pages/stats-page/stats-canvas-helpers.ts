import type {
	DateRange,
	StatsCompareValue,
	StatsPeriodValue,
} from "./stats-page-types";

export function formatIsoDate(date: Date) {
	return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: string | null): Date | null {
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

export function addDays(date: Date, days: number) {
	const copy = new Date(date.getTime());
	copy.setUTCDate(copy.getUTCDate() + days);
	return copy;
}

export function addYears(date: Date, years: number) {
	return new Date(
		Date.UTC(
			date.getUTCFullYear() + years,
			date.getUTCMonth(),
			date.getUTCDate(),
		),
	);
}

export function addMonths(date: Date, months: number) {
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

export function startOfMonth(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function endOfMonth(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function startOfYear(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

export function endOfYear(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), 11, 31));
}

export function normalizeCustomRange(from: string, to: string): DateRange {
	const fromDate = parseIsoDate(from);
	const toDate = parseIsoDate(to);
	if (!fromDate || !toDate) return { from, to };
	if (fromDate <= toDate) return { from, to };
	return { from: to, to: from };
}

export function detectWholeMonth(range: DateRange): { year: number; month: number } | null {
	const fromDate = parseIsoDate(range.from);
	const toDate = parseIsoDate(range.to);
	if (!fromDate || !toDate) return null;
	if (fromDate.getUTCDate() !== 1) return null;
	if (fromDate.getUTCFullYear() !== toDate.getUTCFullYear()) return null;
	if (fromDate.getUTCMonth() !== toDate.getUTCMonth()) return null;
	if (toDate.getUTCDate() !== endOfMonth(fromDate).getUTCDate()) return null;
	return { year: fromDate.getUTCFullYear(), month: fromDate.getUTCMonth() };
}

export function detectWholeYear(range: DateRange): { year: number } | null {
	const fromDate = parseIsoDate(range.from);
	const toDate = parseIsoDate(range.to);
	if (!fromDate || !toDate) return null;
	if (fromDate.getUTCMonth() !== 0 || fromDate.getUTCDate() !== 1) return null;
	if (toDate.getUTCMonth() !== 11 || toDate.getUTCDate() !== 31) return null;
	if (fromDate.getUTCFullYear() !== toDate.getUTCFullYear()) return null;
	return { year: fromDate.getUTCFullYear() };
}

export function rangeDayCount(range: DateRange) {
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

export function resolveBaseRange(
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

export function resolveCompareRange(
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

export function compareLabel(compare: StatsCompareValue) {
	if (compare === "year-over-year") return "vs same period last year";
	if (compare === "none") return "no comparison";
	return "vs previous period";
}

export function percentDelta(current: number, previous: number): number | null {
	if (!Number.isFinite(previous) || previous === 0) return null;
	return ((current - previous) / Math.abs(previous)) * 100;
}

export type BucketGranularity = "day" | "week" | "month";

export function pickGranularity(range: DateRange): BucketGranularity {
	const days = rangeDayCount(range);
	if (days <= 31) return "day";
	if (days <= 120) return "week";
	return "month";
}
