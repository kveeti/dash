import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEncrypted } from "../../encrypted-context";
import {
	deleteFxRates,
	getAppSettings,
	importFxRatesCsv,
	listFxRates,
	updateConversionPolicy,
	updateReportingCurrency,
	upsertFxRate,
	FX_ANCHOR_CURRENCY,
	type AppSettings,
	type ConversionMode,
	type FxCsvImportResult,
	type FxRateRow,
} from "../db/settings";
import { broadcastDbChange } from "../db-change-broadcast";
import { queryKeys, queryKeyRoots } from "./query-keys";

export {
	FX_ANCHOR_CURRENCY,
	type AppSettings,
	type ConversionMode,
	type FxCsvImportResult,
	type FxRateRow,
};

function invalidateConversionDependentQueries(
	qc: ReturnType<typeof useQueryClient>,
) {
	qc.invalidateQueries({ queryKey: queryKeyRoots.transactions });
	qc.invalidateQueries({ queryKey: queryKeyRoots.transaction });
	qc.invalidateQueries({ queryKey: queryKeyRoots.transactionFlows });
	qc.invalidateQueries({ queryKey: queryKeyRoots.stats });
}

export function useAppSettingsQuery() {
	const { db } = useEncrypted();
	return useQuery({
		queryKey: queryKeys.settings(),
		queryFn: () => getAppSettings(db),
	});
}

export function useUpdateReportingCurrencyMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (currency: string) => updateReportingCurrency(db, currency),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeyRoots.settings });
			invalidateConversionDependentQueries(qc);
			broadcastDbChange(["settings", "transactions", "transaction", "transactionFlows", "stats"]);
		},
	});
}

export function useUpdateConversionPolicyMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			maxStalenessDays: number;
			conversionMode: ConversionMode;
		}) => updateConversionPolicy(db, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeyRoots.settings });
			invalidateConversionDependentQueries(qc);
			broadcastDbChange(["settings", "transactions", "transaction", "transactionFlows", "stats"]);
		},
	});
}

export function useFxRatesQuery(limit = 20) {
	const { db } = useEncrypted();
	return useQuery({
		queryKey: queryKeys.fxRates(),
		queryFn: () => listFxRates(db, limit),
	});
}

export function useUpsertFxRateMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			rateDate: string;
			currency: string;
			rateToAnchor: number;
		}) => upsertFxRate(db, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeyRoots.fxRates });
			invalidateConversionDependentQueries(qc);
			broadcastDbChange(["fxRates", "transactions", "transaction", "transactionFlows", "stats"]);
		},
	});
}

export function useDeleteFxRatesMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => deleteFxRates(db),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeyRoots.fxRates });
			invalidateConversionDependentQueries(qc);
			broadcastDbChange(["fxRates", "transactions", "transaction", "transactionFlows", "stats"]);
		},
	});
}

export function useImportFxRatesCsvMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			text: string;
			againstCurrency: string;
		}) => importFxRatesCsv({ db, ...input }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeyRoots.fxRates });
			invalidateConversionDependentQueries(qc);
			broadcastDbChange(["fxRates", "transactions", "transaction", "transactionFlows", "stats"]);
		},
	});
}
