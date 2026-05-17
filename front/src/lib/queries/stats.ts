import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEncrypted } from "../../encrypted-context";
import { normalizeCurrency } from "../currency";
import {
	getConvertedStatTransactions,
	getConvertedStatsSummary,
	getMonthStats,
	getStats,
	getTransactionYears,
	getYearStats,
	type ConvertedStatTransactionRow,
	type ConvertedStatsSummary,
	type MonthStatRow,
	type StatRow,
	type TransactionYearRow,
	type YearStatRow,
} from "../db/stats";
import type { ConversionMode } from "../db/settings";
import type { TransactionFilters } from "../db/transactions";

export type {
	ConvertedStatTransactionRow,
	ConvertedStatsSummary,
	MonthStatRow,
	StatRow,
	TransactionYearRow,
	YearStatRow,
};

type StatsQueryInput = {
	from: string;
	to: string;
	sourceCurrency?: string;
	search?: string;
	filters?: TransactionFilters;
	reportingCurrency?: string;
	maxStalenessDays?: number;
	mode?: ConversionMode;
	enabled?: boolean;
};

function statsScopeKey(input: StatsQueryInput) {
	return [
		input.search ?? "",
		input.filters?.category_id ?? "",
		input.filters?.account_id ?? "",
		input.filters?.currency ?? "",
		input.filters?.currencies?.join(",") ?? "",
		input.filters?.uncategorized ? "1" : "",
		input.filters?.tag_ids?.join(",") ?? "",
	] as const;
}

function normalizeStatsQueryInput(input: StatsQueryInput) {
	const reportingCurrency = input.reportingCurrency
		? normalizeCurrency(input.reportingCurrency)
		: undefined;
	const mode: ConversionMode = input.mode === "lenient" ? "lenient" : "strict";
	const maxStalenessDays = Math.max(0, Math.trunc(input.maxStalenessDays ?? 7));

	return { reportingCurrency, mode, maxStalenessDays };
}

export function useStatsQuery(input: StatsQueryInput) {
	const { db } = useEncrypted();
	const { reportingCurrency, mode, maxStalenessDays } =
		normalizeStatsQueryInput(input);

	return useQuery({
		queryKey: [
			"stats",
			"converted-by-month",
			input.from,
			input.to,
			input.sourceCurrency ?? "",
			...statsScopeKey(input),
			reportingCurrency ?? "",
			maxStalenessDays,
			mode,
		],
		enabled: !!reportingCurrency && (input.enabled ?? true),
		placeholderData: keepPreviousData,
		queryFn: () =>
			getStats({
				db,
				from: input.from,
				to: input.to,
				sourceCurrency: input.sourceCurrency,
				search: input.search,
				filters: input.filters,
				reportingCurrency: reportingCurrency!,
				maxStalenessDays,
				mode,
			}),
	});
}

export function useTransactionYearsQuery() {
	const { db } = useEncrypted();
	return useQuery({
		queryKey: ["stats", "transaction-years"],
		queryFn: () => getTransactionYears(db),
	});
}

export function useYearStatsQuery(input: StatsQueryInput) {
	const { db } = useEncrypted();
	const { reportingCurrency, mode, maxStalenessDays } =
		normalizeStatsQueryInput(input);

	return useQuery({
		queryKey: [
			"stats",
			"converted-by-year",
			input.from,
			input.to,
			input.sourceCurrency ?? "",
			...statsScopeKey(input),
			reportingCurrency ?? "",
			maxStalenessDays,
			mode,
		],
		enabled: !!reportingCurrency && (input.enabled ?? true),
		queryFn: () =>
			getYearStats({
				db,
				from: input.from,
				to: input.to,
				sourceCurrency: input.sourceCurrency,
				search: input.search,
				filters: input.filters,
				reportingCurrency: reportingCurrency!,
				maxStalenessDays,
				mode,
			}),
	});
}

export function useMonthStatsQuery(input: StatsQueryInput) {
	const { db } = useEncrypted();
	const { reportingCurrency, mode, maxStalenessDays } =
		normalizeStatsQueryInput(input);

	return useQuery({
		queryKey: [
			"stats",
			"converted-by-month-total",
			input.from,
			input.to,
			input.sourceCurrency ?? "",
			...statsScopeKey(input),
			reportingCurrency ?? "",
			maxStalenessDays,
			mode,
		],
		enabled: !!reportingCurrency && (input.enabled ?? true),
		placeholderData: keepPreviousData,
		queryFn: () =>
			getMonthStats({
				db,
				from: input.from,
				to: input.to,
				sourceCurrency: input.sourceCurrency,
				search: input.search,
				filters: input.filters,
				reportingCurrency: reportingCurrency!,
				maxStalenessDays,
				mode,
			}),
	});
}

export function useConvertedStatsSummaryQuery(input: StatsQueryInput) {
	const { db } = useEncrypted();
	const { reportingCurrency, mode, maxStalenessDays } =
		normalizeStatsQueryInput(input);

	return useQuery({
		queryKey: [
			"stats",
			"converted-summary",
			input.from,
			input.to,
			input.sourceCurrency ?? "",
			...statsScopeKey(input),
			reportingCurrency ?? "",
			maxStalenessDays,
			mode,
		],
		enabled: !!reportingCurrency && (input.enabled ?? true),
		placeholderData: keepPreviousData,
		queryFn: () =>
			getConvertedStatsSummary({
				db,
				from: input.from,
				to: input.to,
				sourceCurrency: input.sourceCurrency,
				search: input.search,
				filters: input.filters,
				reportingCurrency: reportingCurrency!,
				maxStalenessDays,
				mode,
			}),
	});
}

export function useConvertedStatTransactionsQuery(input: StatsQueryInput & {
	perCategoryLimit?: number;
}) {
	const { db } = useEncrypted();
	const { reportingCurrency, mode, maxStalenessDays } =
		normalizeStatsQueryInput(input);
	const perCategoryLimit =
		input.perCategoryLimit == null
			? undefined
			: Math.max(1, Math.trunc(input.perCategoryLimit));

	return useQuery({
		queryKey: [
			"stats",
			"converted-transactions",
			input.from,
			input.to,
			input.sourceCurrency ?? "",
			...statsScopeKey(input),
			reportingCurrency ?? "",
			maxStalenessDays,
			mode,
			perCategoryLimit ?? "",
		],
		enabled: !!reportingCurrency && (input.enabled ?? true),
		queryFn: () =>
			getConvertedStatTransactions({
				db,
				from: input.from,
				to: input.to,
				sourceCurrency: input.sourceCurrency,
				search: input.search,
				filters: input.filters,
				reportingCurrency: reportingCurrency!,
				maxStalenessDays,
				mode,
				perCategoryLimit,
			}),
	});
}
