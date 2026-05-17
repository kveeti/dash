export type StatsTabValue = "stats-1" | "stats-2" | "canvas";

export type StatsPeriodValue =
	| "this-month"
	| "last-month"
	| "last-7-days"
	| "last-30-days"
	| "last-90-days"
	| "last-12-months"
	| "this-year"
	| "last-year"
	| "custom";

export type StatsCompareValue = "previous" | "year-over-year" | "none";

export type StatsAmountMode = "total" | "per-day";

export type DateRange = {
	from: string;
	to: string;
};
