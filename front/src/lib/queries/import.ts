import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEncrypted } from "../../encrypted-context";
import {
	importCsv,
	importLegacyCsvBundle,
	type CsvFormat,
	type ImportResult,
	type LegacyBundleTexts,
} from "../db/import";
import { broadcastDbChange } from "../db-change-broadcast";
import { currencyMetaQueryOptions } from "./currencies";
import { queryKeyRoots } from "./query-keys";

export type { CsvFormat, ImportResult, LegacyBundleTexts };

function invalidateImportQueries(qc: ReturnType<typeof useQueryClient>) {
	qc.invalidateQueries({ queryKey: queryKeyRoots.transactions });
	qc.invalidateQueries({ queryKey: queryKeyRoots.categories });
	qc.invalidateQueries({ queryKey: queryKeyRoots.accounts });
	broadcastDbChange(["transactions", "categories", "accounts", "stats"]);
}

export function useImportCsvMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			text: string;
			format: CsvFormat;
			account: {
				id: string;
				currency: string;
			};
		}) =>
			qc
				.ensureQueryData(currencyMetaQueryOptions(db))
				.then((currencyMeta) =>
					importCsv(db, input.text, input.format, input.account, currencyMeta),
				),
		onSuccess: () => {
			invalidateImportQueries(qc);
		},
	});
}

export function useImportLegacyCsvBundleMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (files: LegacyBundleTexts) =>
			qc
				.ensureQueryData(currencyMetaQueryOptions(db))
				.then((currencyMeta) => importLegacyCsvBundle(db, files, currencyMeta)),
		onSuccess: () => {
			invalidateImportQueries(qc);
			qc.invalidateQueries({ queryKey: queryKeyRoots.transactionFlows });
			broadcastDbChange(["transactionFlows", "transactionLinkSuggestions"]);
		},
	});
}
