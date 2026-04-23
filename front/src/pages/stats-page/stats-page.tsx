import { useMemo } from "react";
import { useLocation, useSearchParams } from "wouter";
import { useTransactionYearsQuery } from "../../lib/queries/stats";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "../../components/tabs";
import { useAppSettingsQuery } from "../../lib/queries/settings";
import { DesktopYearMonthExplorer } from "./desktop-year-month-explorer";
import { StatsOverviewPanel } from "./stats-overview-panel";
import {
	type DateRange,
	type StatsCompareValue,
	type StatsPeriodValue,
	type StatsTabValue,
} from "./stats-page-types";

function parseStatsTabValue(value: string | null): StatsTabValue {
	return value === "stats-2" ? "stats-2" : "stats-1";
}

function parseStatsPeriodValue(value: string | null): StatsPeriodValue {
	if (
		value === "this-month" ||
		value === "last-month" ||
		value === "this-year" ||
		value === "last-year" ||
		value === "custom"
	) {
		return value;
	}
	return "this-month";
}

function parseStatsCompareValue(value: string | null): StatsCompareValue {
	if (value === "year-over-year" || value === "none") return value;
	return "previous";
}

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

function startOfMonth(date: Date) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function defaultCustomRange(now: Date): DateRange {
	const from = formatIsoDate(startOfMonth(now));
	const to = formatIsoDate(now);
	return { from, to };
}

function normalizeCustomRange(from: string, to: string): DateRange {
	const fromDate = parseIsoDate(from);
	const toDate = parseIsoDate(to);
	if (!fromDate || !toDate) return { from, to };
	if (fromDate <= toDate) return { from, to };
	return { from: to, to: from };
}

export function StatsPage() {
	const settings = useAppSettingsQuery();
	const [searchParams] = useSearchParams();
	const [, navigate] = useLocation();

	const nowUtc = useMemo(() => new Date(), []);
	const activeTab = parseStatsTabValue(searchParams.get("tab"));
	const period = parseStatsPeriodValue(searchParams.get("period"));
	const compare = parseStatsCompareValue(searchParams.get("compare"));

	const defaultCustom = useMemo(() => defaultCustomRange(nowUtc), [nowUtc]);
	const rawCustomFrom = parseIsoDate(searchParams.get("from"))
		? searchParams.get("from")!
		: defaultCustom.from;
	const rawCustomTo = parseIsoDate(searchParams.get("to"))
		? searchParams.get("to")!
		: defaultCustom.to;
	const normalizedCustom = useMemo(
		() => normalizeCustomRange(rawCustomFrom, rawCustomTo),
		[rawCustomFrom, rawCustomTo],
	);
	const customFrom = normalizedCustom.from;
	const customTo = normalizedCustom.to;

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
						/>
					</TabsPanel>

				<TabsPanel value="stats-2">
					<StatsOverviewPanel
						reportingCurrency={reportingCurrency}
						queryReportingCurrency={settings.data?.reporting_currency}
						mode={mode}
						maxStalenessDays={maxStalenessDays}
							period={period}
							compare={compare}
							customFrom={customFrom}
							customTo={customTo}
							onPeriodChange={(value) => {
								if (value === "custom") {
									setStatsParams({
										period: value,
										from: customFrom,
										to: customTo,
									});
									return;
								}
								setStatsParams({
									period: value,
									from: undefined,
									to: undefined,
								});
							}}
							onCompareChange={(value) => setStatsParams({ compare: value })}
							onCustomRangeChange={(from, to) =>
								setStatsParams({
									period: "custom",
									from,
									to,
								})
							}
						/>
					</TabsPanel>
			</TabsRoot>
		</div>
	);
}
