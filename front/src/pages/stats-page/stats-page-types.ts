export type StatsTabValue = "stats-1" | "stats-2";

export type StatsPeriodValue =
	| "this-month"
	| "last-month"
	| "this-year"
	| "last-year"
	| "custom";

export type StatsCompareValue = "previous" | "year-over-year" | "none";

export type DateRange = {
	from: string;
	to: string;
};
