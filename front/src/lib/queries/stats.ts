import { useQuery } from "@tanstack/react-query";
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
	reportingCurrency?: string;
	maxStalenessDays?: number;
	mode?: ConversionMode;
	enabled?: boolean;
};

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
			reportingCurrency ?? "",
			maxStalenessDays,
			mode,
		],
		enabled: !!reportingCurrency && (input.enabled ?? true),
		queryFn: () =>
			getStats({
				db,
				from: input.from,
				to: input.to,
				sourceCurrency: input.sourceCurrency,
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
			reportingCurrency ?? "",
			maxStalenessDays,
			mode,
		],
		enabled: !!reportingCurrency && (input.enabled ?? true),
		queryFn: () =>
			getMonthStats({
				db,
				from: input.from,
				to: input.to,
				sourceCurrency: input.sourceCurrency,
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
			reportingCurrency ?? "",
			maxStalenessDays,
			mode,
		],
		enabled: !!reportingCurrency && (input.enabled ?? true),
		queryFn: () =>
			getConvertedStatsSummary({
				db,
				from: input.from,
				to: input.to,
				sourceCurrency: input.sourceCurrency,
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
				reportingCurrency: reportingCurrency!,
				maxStalenessDays,
				mode,
				perCategoryLimit,
			}),
	});
}
