import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { useDb } from "../../providers";
import { DEFAULT_CURRENCY, normalizeCurrency, parseCurrency } from "../currency";
import type { DbHandle } from "../db";
import { queryKeys, queryKeyRoots } from "./query-keys";

export type ConversionMode = "strict" | "lenient";
export const FX_ANCHOR_CURRENCY = "EUR";

export type AppSettings = {
	reporting_currency: string;
	max_staleness_days: number;
	conversion_mode: ConversionMode;
	updated_at: string;
};

export type FxRateRow = {
	rate_date: string;
	currency: string;
	rate_to_anchor: number;
};

export type FxCsvImportResult = {
	imported: number;
	skipped: number;
	errors: string[];
};

function invalidateConversionDependentQueries(
	qc: ReturnType<typeof useQueryClient>,
) {
	qc.invalidateQueries({ queryKey: queryKeyRoots.transactions });
	qc.invalidateQueries({ queryKey: queryKeyRoots.transaction });
	qc.invalidateQueries({ queryKey: queryKeyRoots.transactionLinks });
}

function normalizeConversionMode(value: string | null | undefined): ConversionMode {
	return value === "lenient" ? "lenient" : "strict";
}

function normalizeDateYmd(raw: string): string {
	const value = raw.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error(`invalid date format: ${raw}`);
	}
	const parsed = new Date(`${value}T00:00:00Z`);
	if (isNaN(parsed.getTime())) {
		throw new Error(`invalid date: ${raw}`);
	}
	if (parsed.toISOString().slice(0, 10) !== value) {
		throw new Error(`invalid calendar date: ${raw}`);
	}
	return value;
}

function parseRate(raw: string): number {
	const normalized = raw.trim().replace(",", ".");
	const rate = Number.parseFloat(normalized);
	if (!Number.isFinite(rate) || rate <= 0) {
		throw new Error(`invalid rate: ${raw}`);
	}
	return rate;
}

function parseFxCsvRows(text: string) {
	const parse = (delimiter?: string) =>
		Papa.parse<string[]>(text, {
			delimiter,
			skipEmptyLines: "greedy",
		});

	let result = parse();
	if (
		result.data.length > 0 &&
		result.data[0].length === 1 &&
		(result.data[0][0] ?? "").includes(";")
	) {
		result = parse(";");
	}

	return {
		rows: result.data.map((row) => row.map((cell) => cell ?? "")),
		errors: result.errors,
	};
}

async function importFxRatesCsv({
	db,
	text,
	againstCurrency,
}: {
	db: DbHandle;
	text: string;
	againstCurrency: string;
}): Promise<FxCsvImportResult> {
	const against = parseCurrency(againstCurrency);
	const anchor = FX_ANCHOR_CURRENCY;
	const parsed = parseFxCsvRows(text);
	const errors: string[] = [];
	let skipped = 0;

	if (parsed.errors.length > 0) {
		for (const err of parsed.errors) {
			const lineNum = typeof err.row === "number" ? err.row + 1 : "?";
			errors.push(`line ${lineNum}: ${err.message}`);
			skipped++;
		}
	}

	if (parsed.rows.length === 0) {
		throw new Error("csv is empty");
	}
	if (parsed.rows[0].length < 2) {
		throw new Error("csv requires date column + at least one currency column");
	}

	const header = parsed.rows[0].map((col) => col.trim());
	const currencies: string[] = [];
	const seenCurrencies = new Set<string>();
	for (let i = 1; i < header.length; i++) {
		const columnHeader = header[i];
		const currency = parseCurrency(columnHeader);
		if (seenCurrencies.has(currency)) {
			throw new Error(`duplicate currency column: ${currency}`);
		}
		seenCurrencies.add(currency);
		currencies.push(currency);
	}

	type FxInsertRow = {
		rateDate: string;
		currency: string;
		rateToAnchor: number;
	};

	const anchorColumnIndex = currencies.findIndex((currency) => currency === anchor);
	const inserts: FxInsertRow[] = [];

	for (let i = 1; i < parsed.rows.length; i++) {
		const row = parsed.rows[i];
		const lineNum = i + 1;
		const dateCell = row[0] ?? "";

		let rateDate: string;
		try {
			rateDate = normalizeDateYmd(dateCell);
		} catch (err) {
			skipped++;
			errors.push(`line ${lineNum}: ${err instanceof Error ? err.message : String(err)}`);
			continue;
		}

		let anchorAgainst = 1;
		if (against !== anchor) {
			if (anchorColumnIndex < 0) {
				skipped += Math.max(0, currencies.length - 1);
				errors.push(`line ${lineNum}: missing ${anchor} column required for against=${against}`);
				continue;
			}
			const rawAnchorAgainst = (row[anchorColumnIndex + 1] ?? "").trim();
			if (!rawAnchorAgainst) {
				skipped += Math.max(0, currencies.length - 1);
				errors.push(`line ${lineNum}: missing ${anchor} rate required for against=${against}`);
				continue;
			}
			try {
				anchorAgainst = parseRate(rawAnchorAgainst);
			} catch (err) {
				skipped += Math.max(0, currencies.length - 1);
				errors.push(
					`line ${lineNum}, ${anchor}: ${err instanceof Error ? err.message : String(err)}`,
				);
				continue;
			}
		}

		for (let col = 1; col < header.length; col++) {
			const currency = currencies[col - 1];
			if (currency === against || currency === anchor) continue;

			const rawRate = (row[col] ?? "").trim();
			if (!rawRate) continue;

			try {
				const rateAgainst = parseRate(rawRate);
				const rateToAnchor = anchorAgainst / rateAgainst;
				inserts.push({
					rateDate,
					currency,
					rateToAnchor,
				});
			} catch (err) {
				skipped++;
				errors.push(`line ${lineNum}, ${currency}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	if (inserts.length === 0) {
		return { imported: 0, skipped, errors };
	}

	const FX_IMPORT_BATCH_SIZE = 100;
	await db.withTx(async () => {
		for (let i = 0; i < inserts.length; i += FX_IMPORT_BATCH_SIZE) {
			const batch = inserts.slice(i, i + FX_IMPORT_BATCH_SIZE);
			const placeholders = batch.map(() => "(?, ?, ?)").join(", ");
			const values = batch.flatMap((row) => [
				row.rateDate,
				row.currency,
				row.rateToAnchor,
			]);
			await db.exec(
				`insert into fx_rates
				(rate_date, currency, rate_to_anchor)
				values ${placeholders}
				on conflict (currency, rate_date) do update set
					rate_to_anchor = excluded.rate_to_anchor`,
				values,
			);
		}
	});

	return {
		imported: inserts.length,
		skipped,
		errors,
	};
}

async function getAppSettings(db: DbHandle): Promise<AppSettings> {
	const rows = await db.query<AppSettings>(
		`select reporting_currency, max_staleness_days, conversion_mode, updated_at
		from app_settings
		where id = 1
		limit 1`,
	);
	if (rows.length > 0) {
		return {
			...rows[0],
			reporting_currency: normalizeCurrency(rows[0].reporting_currency),
			max_staleness_days: Math.max(0, Number(rows[0].max_staleness_days ?? 7)),
			conversion_mode: normalizeConversionMode(rows[0].conversion_mode),
		};
	}

	const now = new Date().toISOString();
	await db.exec(
		`insert into app_settings (
			id, reporting_currency, max_staleness_days, conversion_mode, updated_at
		)
		values (1, ?, 7, 'strict', ?)`,
		[DEFAULT_CURRENCY, now],
	);
	return {
		reporting_currency: DEFAULT_CURRENCY,
		max_staleness_days: 7,
		conversion_mode: "strict",
		updated_at: now,
	};
}

export function useAppSettingsQuery() {
	const db = useDb();
	return useQuery({
		queryKey: queryKeys.settings(),
		queryFn: () => getAppSettings(db),
	});
}

export function useUpdateReportingCurrencyMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (currency: string) => {
			const now = new Date().toISOString();
			await db.exec(
				`update app_settings
				set reporting_currency = ?, updated_at = ?
				where id = 1`,
				[normalizeCurrency(currency), now],
			);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeyRoots.settings });
			invalidateConversionDependentQueries(qc);
		},
	});
}

export function useUpdateConversionPolicyMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (input: {
			maxStalenessDays: number;
			conversionMode: ConversionMode;
		}) => {
			const now = new Date().toISOString();
			await db.exec(
				`update app_settings
				set max_staleness_days = ?,
					conversion_mode = ?,
					updated_at = ?
				where id = 1`,
				[
					Math.max(0, Math.trunc(input.maxStalenessDays)),
					normalizeConversionMode(input.conversionMode),
					now,
				],
			);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeyRoots.settings });
			invalidateConversionDependentQueries(qc);
		},
	});
}

async function getFxRates(
	db: DbHandle,
	limit = 20,
): Promise<FxRateRow[]> {
	return db.query<FxRateRow>(
		`select
			rate_date,
			currency,
			rate_to_anchor
		from fx_rates
		order by rate_date desc, currency asc
		limit ?`,
		[limit],
	);
}

export function useFxRatesQuery(limit = 20) {
	const db = useDb();
	return useQuery({
		queryKey: queryKeys.fxRates(),
		queryFn: () => getFxRates(db, limit),
	});
}

export function useUpsertFxRateMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (input: {
			rateDate: string;
			currency: string;
			rateToAnchor: number;
		}) => {
			await db.exec(
				`insert into fx_rates
				(rate_date, currency, rate_to_anchor)
				values (?, ?, ?)
				on conflict (currency, rate_date) do update set
					rate_to_anchor = excluded.rate_to_anchor`,
				[
					input.rateDate,
					normalizeCurrency(input.currency),
					input.rateToAnchor,
				],
			);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeyRoots.fxRates });
			invalidateConversionDependentQueries(qc);
		},
	});
}

export function useDeleteFxRatesMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async () => {
			await db.exec("delete from fx_rates");
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeyRoots.fxRates });
			invalidateConversionDependentQueries(qc);
		},
	});
}

export function useImportFxRatesCsvMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			text: string;
			againstCurrency: string;
		}) => importFxRatesCsv({ db, ...input }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeyRoots.fxRates });
			invalidateConversionDependentQueries(qc);
		},
	});
}
