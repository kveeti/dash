import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DbHandle } from "../db";
import Papa from "papaparse";
import { id } from "../id";
import { useDb } from "../../providers";
import { queryKeyRoots } from "./query-keys";
import { getOrCreateCategoryByName } from "./categories";
import { getCurrencyMeta, parseCurrency, parseDecimalToMinorUnits } from "../currency";

export type CsvFormat =
	| "generic"
	| "op"
	| "nordea"
	| "revolut"
	| "legacy_bundle";

export type ImportResult = {
	imported: number;
	deduped?: number;
	skipped: number;
	errors: string[];
	accounts_imported?: number;
	categories_imported?: number;
};

export type LegacyBundleTexts = {
	transactionsCsv: string;
	accountsCsv: string;
	categoriesCsv: string;
};

function invalidateImportQueries(qc: ReturnType<typeof useQueryClient>) {
	qc.invalidateQueries({ queryKey: queryKeyRoots.transactions });
	qc.invalidateQueries({ queryKey: queryKeyRoots.categories });
	qc.invalidateQueries({ queryKey: queryKeyRoots.accounts });
}

export function useImportCsvMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			text: string;
			format: CsvFormat;
			account: {
				id: string;
				currency: string;
			};
		}) => importCsv(db, input.text, input.format, input.account),
		onSuccess: () => {
			invalidateImportQueries(qc);
		},
	});
}

export function useImportLegacyCsvBundleMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (files: LegacyBundleTexts) => importLegacyCsvBundle(db, files),
		onSuccess: () => {
			invalidateImportQueries(qc);
			qc.invalidateQueries({ queryKey: queryKeyRoots.transactionFlows });
		},
	});
}

type ParsedTransaction = {
	date: string;
	amount: string;
	currency?: string;
	counter_party: string;
	additional?: string;
	category_name?: string;
};

function parseGenericRow(cols: string[]): ParsedTransaction {
	const date = cols[0]?.trim();
	if (!date) throw new Error("missing date");
	const parsed = new Date(date);
	if (isNaN(parsed.getTime())) throw new Error(`invalid date: ${date}`);

	const amount = parseAmount(cols[1] ?? "");
	const counter_party = cols[2]?.trim();
	if (!counter_party) throw new Error("missing counter_party");

	return {
		date: parsed.toISOString(),
		amount,
		currency: cols[5]?.trim() || undefined,
		counter_party,
		additional: cols[3]?.trim() || undefined,
		category_name: cols[4]?.trim() || undefined,
	};
}

function parseOpRow(cols: string[]): ParsedTransaction {
	const dateStr = cols[0]?.trim();
	let date: Date;
	if (dateStr) {
		date = new Date(dateStr + "T00:00:00Z");
		if (isNaN(date.getTime())) throw new Error(`invalid date: ${dateStr}`);
	} else {
		date = new Date();
	}

	const amount = parseAmount(cols[2] ?? "");
	const counter_party = cols[5]?.trim() || "NONAME";

	const additionalParts: string[] = [];
	const addField = (label: string, value: string | undefined) => {
		const trimmed = value?.trim();
		if (trimmed) additionalParts.push(`${label}: ${trimmed}`);
	};

	addField("Selitys", cols[4]);
	addField("Saajan tilinumero", cols[6]);

	if (cols[9]?.trim()) {
		const msg = cols[9]
			.trim()
			.replace(/^Viesti:/, "")
			.trim();
		if (msg) additionalParts.push(`Viesti: ${msg}`);
	}
	if (cols[8]?.trim()) {
		const ref = cols[8].trim().replace(/^ref=/, "").trim();
		if (ref) additionalParts.push(`Viite: ${ref}`);
	}

	addField("Laji", cols[3]);
	addField("Saajan pankin BIC", cols[7]);
	addField("Arkistointitunnus", cols[10]);
	addField("Arvopäivä", cols[1]);

	return {
		date: date.toISOString(),
		amount,
		counter_party,
		additional: additionalParts.join(", ") || undefined,
	};
}

function parseNordeaDate(raw: string): Date {
	const trimmed = raw.trim();
	const match = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
	if (!match) throw new Error(`invalid date: ${raw}`);
	const [, year, month, day] = match;
	const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	if (isNaN(date.getTime())) throw new Error(`invalid date: ${raw}`);
	return date;
}

function parseNordeaRow(cols: string[]): ParsedTransaction {
	const dateStr = cols[0]?.trim();
	if (!dateStr) throw new Error("missing date");
	const date = parseNordeaDate(dateStr);

	const amount = parseAmount(cols[1] ?? "");
	const counter_party = cols[5]?.trim();
	if (!counter_party) throw new Error("missing counter_party");

	const additionalParts: string[] = [];
	const addField = (label: string, value: string | undefined) => {
		const trimmed = value?.trim();
		if (trimmed) additionalParts.push(`${label}: ${trimmed}`);
	};

	addField("Viesti", cols[6]);
	addField("Viitenumero", cols[7]);

	return {
		date: date.toISOString(),
		amount,
		currency: cols[9]?.trim() || undefined,
		counter_party,
		additional: additionalParts.join(", ") || undefined,
	};
}

function parseRevolutRow(cols: string[]): ParsedTransaction | null {
	const state = cols[8]?.trim().toUpperCase();
	if (state !== "COMPLETED") return null;

	const dateStr = cols[2]?.trim();
	if (!dateStr) throw new Error("missing date");
	const date = new Date(dateStr);
	if (isNaN(date.getTime())) throw new Error(`invalid date: ${dateStr}`);

	const counter_party = cols[4]?.trim();
	if (!counter_party) throw new Error("missing counter_party");

	const amount = parseAmount(cols[5] ?? "");
	const feeRaw = cols[6]?.trim() ?? "";
	const fee = feeRaw ? parseAmount(feeRaw) : "0";

	return {
		date: date.toISOString(),
		amount: String(Number(amount) + Number(fee)),
		currency: cols[7]?.trim() || undefined,
		counter_party,
		additional: fee !== 0 ? `Fee: ${fee}` : undefined,
	};
}

type ParsedCsvTable = {
	headers: string[];
	rows: Array<{ lineNum: number; record: Record<string, string> }>;
};

type ParsedCsvImportRow = {
	row: ParsedTransaction;
	currency: string;
	importKey: string;
};

type ImportKeyRow = {
	id: string;
	key_value: string;
};

type ImportKeyIdentity = {
	sourceType: string;
	sourceScope: string;
	keyType: string;
	keyValue: string;
};

const CSV_SOURCE_TYPE = "csv";
const textEncoder = new TextEncoder();

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function normalizeHeader(h: string): string {
	return h.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function normalizeFingerprintText(value: string | undefined): string {
	return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest(
		"SHA-256",
		textEncoder.encode(value),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function csvKeyType(format: Exclude<CsvFormat, "legacy_bundle">): string {
	return `csv_${format}_fingerprint_v1`;
}

function csvFingerprintBase(row: ParsedTransaction, currency: string): string {
	return JSON.stringify([
		row.date,
		row.amount,
		currency,
		normalizeFingerprintText(row.counter_party),
		normalizeFingerprintText(row.additional),
	]);
}

async function attachCsvImportKeys(
	rows: Array<{ row: ParsedTransaction; lineNum: number }>,
	format: Exclude<CsvFormat, "legacy_bundle">,
	defaultCurrency: string,
): Promise<ParsedCsvImportRow[]> {
	const seen = new Map<string, number>();

	return Promise.all(
		rows.map(async ({ row }) => {
			const currency = parseCurrency(row.currency, defaultCurrency);
			const base = csvFingerprintBase(row, currency);
			const occurrence = seen.get(base) ?? 0;
			seen.set(base, occurrence + 1);
			const importKey = await sha256Hex(
				JSON.stringify([csvKeyType(format), base, occurrence]),
			);

			return { row, currency, importKey };
		}),
	);
}

async function getExistingImportKeys(
	db: DbHandle,
	identity: Omit<ImportKeyIdentity, "keyValue">,
	keyValues: string[],
): Promise<Map<string, ImportKeyRow>> {
	const uniqueKeyValues = [...new Set(keyValues)];
	const existing = new Map<string, ImportKeyRow>();
	const BATCH = 200;

	for (let i = 0; i < uniqueKeyValues.length; i += BATCH) {
		const batch = uniqueKeyValues.slice(i, i + BATCH);
		if (batch.length === 0) continue;
		const placeholders = batch.map(() => "?").join(",");
		const rows = await db.query<ImportKeyRow>(
			`select id, key_value
			from transaction_import_keys
			where _sync_is_deleted = 0
				and source_type = ?
				and source_scope = ?
				and key_type = ?
				and key_value in (${placeholders})`,
			[
				identity.sourceType,
				identity.sourceScope,
				identity.keyType,
				...batch,
			],
		);
		for (const row of rows) existing.set(row.key_value, row);
	}

	return existing;
}

async function touchImportKeys(
	db: DbHandle,
	keyIds: string[],
	now: string,
): Promise<void> {
	const uniqueIds = [...new Set(keyIds)];
	const BATCH = 200;

	for (let i = 0; i < uniqueIds.length; i += BATCH) {
		const batch = uniqueIds.slice(i, i + BATCH);
		if (batch.length === 0) continue;
		const placeholders = batch.map(() => "?").join(",");
		await db.exec(
			`update transaction_import_keys
			set last_seen_at = ?,
				seen_count = seen_count + 1,
				_sync_status = 1,
				_sync_edited_at = ?
			where id in (${placeholders})`,
			[now, Date.now(), ...batch],
		);
	}
}

async function insertImportKey(
	db: DbHandle,
	identity: ImportKeyIdentity,
	transactionId: string,
	now: string,
): Promise<void> {
	const editedAt = Date.now();
	await db.exec(
		`insert into transaction_import_keys (
			id, transaction_id, source_type, source_scope, key_type, key_value,
			created_at, last_seen_at, seen_count, _sync_edited_at
		)
		values (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
		on conflict(source_type, source_scope, key_type, key_value)
		where _sync_is_deleted = 0
		do update set
			last_seen_at = excluded.last_seen_at,
			seen_count = transaction_import_keys.seen_count + 1,
			_sync_status = 1,
			_sync_edited_at = excluded._sync_edited_at`,
		[
			id(),
			transactionId,
			identity.sourceType,
			identity.sourceScope,
			identity.keyType,
			identity.keyValue,
			now,
			now,
			editedAt,
		],
	);
}

function parseAmount(raw: string): string {
	const cleaned = raw.replace(/[–—]/g, "-").replace(",", ".").trim();
	const n = parseFloat(cleaned);
	if (isNaN(n)) throw new Error(`invalid amount: ${raw}`);
	return cleaned;
}

function parseOptionalDate(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const parsed = new Date(trimmed);
	if (isNaN(parsed.getTime())) throw new Error(`invalid date: ${raw}`);
	return parsed.toISOString();
}

function parseRequiredDate(raw: string): string {
	const parsed = parseOptionalDate(raw);
	if (!parsed) throw new Error("missing date");
	return parsed;
}

function parseBool(raw: string): number {
	const value = raw.trim().toLowerCase();
	if (!value) return 0;
	if (value === "1" || value === "true" || value === "t" || value === "yes" || value === "y") {
		return 1;
	}
	if (value === "0" || value === "false" || value === "f" || value === "no" || value === "n") {
		return 0;
	}
	throw new Error(`invalid boolean: ${raw}`);
}

function parseCsvRows(
	text: string,
	delimiter?: string,
): { rows: string[][]; errors: string[] } {
	const result = Papa.parse<string[]>(text, {
		delimiter,
		skipEmptyLines: "greedy",
	});

	const rows = result.data.map((row) => row.map((value) => value ?? ""));
	const errors = result.errors.map((error) => {
		const rowNum = typeof error.row === "number" ? error.row + 1 : "?";
		return `row ${rowNum}: ${error.message}`;
	});

	return { rows, errors };
}

function parseCsvTable(
	text: string,
	requiredHeaders: string[],
	fileName: string,
): ParsedCsvTable {
	const parsed = parseCsvRows(text);
	if (parsed.rows.length === 0) throw new Error(`${fileName}: file is empty`);
	if (parsed.errors.length > 0) {
		throw new Error(`${fileName}: ${parsed.errors[0]}`);
	}

	const headers = parsed.rows[0].map(normalizeHeader);

	for (const header of requiredHeaders) {
		if (!headers.includes(header)) {
			throw new Error(`${fileName}: missing required column "${header}"`);
		}
	}

	const rows: ParsedCsvTable["rows"] = [];
	for (let i = 1; i < parsed.rows.length; i++) {
		const cols = parsed.rows[i];
		const record: Record<string, string> = {};
		let hasValue = false;

		for (let j = 0; j < headers.length; j++) {
			const value = (cols[j] ?? "").trim();
			if (value) hasValue = true;
			record[headers[j]] = value;
		}

		if (!hasValue) continue;
		rows.push({ lineNum: i + 1, record });
	}

	return { headers, rows };
}

export async function importCsv(
	db: DbHandle,
	text: string,
	format: CsvFormat,
	account: { id: string; currency: string },
): Promise<ImportResult> {
	if (format === "legacy_bundle") {
		throw new Error("legacy bundle imports must use importLegacyCsvBundle");
	}

	const parsedCsv = parseCsvRows(
		text,
		format === "op" || format === "nordea" ? ";" : undefined,
	);
	const parse:
		| ((cols: string[]) => ParsedTransaction)
		| ((cols: string[]) => ParsedTransaction | null) =
		format === "op"
			? parseOpRow
			: format === "nordea"
				? parseNordeaRow
				: format === "revolut"
					? parseRevolutRow
				: parseGenericRow;
	const accountId = account.id;
	const defaultCurrency = parseCurrency(account.currency);
	const importKeyIdentity = {
		sourceType: CSV_SOURCE_TYPE,
		sourceScope: accountId,
		keyType: csvKeyType(format),
	};

	let skipped = parsedCsv.errors.length;
	const errors: string[] = [...parsedCsv.errors];

	const parsed: { row: ParsedTransaction; lineNum: number }[] = [];
	for (let i = 0; i < parsedCsv.rows.length; i++) {
		const cols = parsedCsv.rows[i];
		try {
			const row = parse(cols);
			if (!row) {
				skipped++;
				continue;
			}
			parsed.push({ row, lineNum: i + 1 });
		} catch (e: unknown) {
			if (i === 0) {
				skipped++;
				continue;
			}
			errors.push(`row ${i + 1}: ${getErrorMessage(e)}`);
			skipped++;
		}
	}

	const keyedRows = await attachCsvImportKeys(parsed, format, defaultCurrency);
	const existingKeys = await getExistingImportKeys(
		db,
		importKeyIdentity,
		keyedRows.map(({ importKey }) => importKey),
	);
	const dedupedRows = keyedRows.filter(({ importKey }) =>
		existingKeys.has(importKey),
	);
	const newRows = keyedRows.filter(({ importKey }) => !existingKeys.has(importKey));

	const categoryCache = new Map<string, string>();
	const uniqueCategories = new Set(
		newRows.map((p) => p.row.category_name).filter((n): n is string => !!n),
	);
	for (const name of uniqueCategories) {
		categoryCache.set(name, await getOrCreateCategoryByName(db, name));
	}
	const currencyMetaByCode = new Map<string, Awaited<ReturnType<typeof getCurrencyMeta>>>();
	for (const currency of new Set(newRows.map((row) => row.currency))) {
		currencyMetaByCode.set(currency, await getCurrencyMeta(db, currency));
	}

	const now = new Date().toISOString();
	const BATCH = 50;
	return db.withTx(async () => {
		await touchImportKeys(
			db,
			dedupedRows.map(({ importKey }) => existingKeys.get(importKey)!.id),
			now,
		);

		for (let i = 0; i < newRows.length; i += BATCH) {
			const batch = newRows.slice(i, i + BATCH);
			const placeholders = batch
				.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
				.join(", ");
			const editedAt = Date.now();
			const txIds = batch.map(() => id());
			const values = batch.flatMap(({ row, currency }, index) => [
				txIds[index],
				now,
				now,
				row.date,
				parseDecimalToMinorUnits(row.amount, currencyMetaByCode.get(currency)!),
				currency,
				row.counter_party,
				row.additional ?? null,
				row.category_name ? categoryCache.get(row.category_name)! : null,
				accountId,
				editedAt,
			]);
			await db.exec(
				`insert into transactions
				 (id, created_at, updated_at, date, amount_minor, currency, counter_party, additional, category_id, account_id, _sync_edited_at)
				 values ${placeholders}`,
				values,
			);

			for (let j = 0; j < batch.length; j++) {
				await insertImportKey(
					db,
					{ ...importKeyIdentity, keyValue: batch[j].importKey },
					txIds[j],
					now,
				);
			}
		}
		return {
			imported: newRows.length,
			deduped: dedupedRows.length,
			skipped,
			errors,
		};
	});
}

export async function importLegacyCsvBundle(
	db: DbHandle,
	files: LegacyBundleTexts,
): Promise<ImportResult> {
	const accountsTable = parseCsvTable(
		files.accountsCsv,
		["id", "name"],
		"accounts.csv",
	);
	const categoriesTable = parseCsvTable(
		files.categoriesCsv,
		["id", "name", "is_neutral"],
		"categories.csv",
	);
	const transactionsTable = parseCsvTable(
		files.transactionsCsv,
		[
			"id",
			"date",
			"categorize_on",
			"amount",
			"currency",
			"counter_party",
			"additional",
			"notes",
			"category_id",
			"account_id",
		],
		"transactions.csv",
	);
	let skipped = 0;
	const errors: string[] = [];

	return db.withTx(async () => {
		const now = new Date().toISOString();
		let accountsImported = 0;
		let categoriesImported = 0;
		let transactionsImported = 0;
		const existingAccounts = await db.query<{ id: string; name: string }>(
			"select id, name from accounts where _sync_is_deleted = 0",
		);
		const existingAccountNames = new Map(existingAccounts.map((a) => [a.name, a.id]));
		const existingAccountIds = new Set(existingAccounts.map((a) => a.id));
		const accountIdMap = new Map<string, string>();

		for (const { lineNum, record } of accountsTable.rows) {
			const oldId = record.id;
			const name = record.name;
			if (!oldId || !name) {
				skipped++;
				errors.push(`accounts.csv row ${lineNum}: missing id or name`);
				continue;
			}

			const existingByName = existingAccountNames.get(name);
			if (existingByName) {
				accountIdMap.set(oldId, existingByName);
				continue;
			}

			const newId = existingAccountIds.has(oldId) ? id() : oldId;
			const currency = parseCurrency(record.currency, "EUR");
			const externalId = record.external_id?.trim() || null;
			await db.exec(
				`insert into accounts (id, created_at, updated_at, name, currency, external_id, _sync_edited_at)
				values (?, ?, ?, ?, ?, ?, ?)`,
				[newId, now, now, name, currency, externalId, Date.now()],
			);
			accountIdMap.set(oldId, newId);
			existingAccountNames.set(name, newId);
			existingAccountIds.add(newId);
			accountsImported++;
		}

		const existingCategories = await db.query<{ id: string; name: string }>(
			"select id, name from categories where _sync_is_deleted = 0",
		);
		const existingCategoryNames = new Map(existingCategories.map((c) => [c.name, c.id]));
		const existingCategoryIds = new Set(existingCategories.map((c) => c.id));
		const categoryIdMap = new Map<string, string>();

		for (const { lineNum, record } of categoriesTable.rows) {
			const oldId = record.id;
			const name = record.name;
			if (!oldId || !name) {
				skipped++;
				errors.push(`categories.csv row ${lineNum}: missing id or name`);
				continue;
			}

			const existingByName = existingCategoryNames.get(name);
			if (existingByName) {
				categoryIdMap.set(oldId, existingByName);
				continue;
			}

			let isNeutral = 0;
			try {
				isNeutral = parseBool(record.is_neutral ?? "");
			} catch (e: unknown) {
				skipped++;
				errors.push(`categories.csv row ${lineNum}: ${getErrorMessage(e)}`);
				continue;
			}

			const newId = existingCategoryIds.has(oldId) ? id() : oldId;
			await db.exec(
				`insert into categories (id, created_at, updated_at, name, is_neutral, _sync_edited_at)
				values (?, ?, ?, ?, ?, ?)`,
				[newId, now, now, name, isNeutral, Date.now()],
			);
			categoryIdMap.set(oldId, newId);
			existingCategoryNames.set(name, newId);
			existingCategoryIds.add(newId);
			categoriesImported++;
		}

		const existingTransactionRows = await db.query<{ id: string }>(
			"select id from transactions",
		);
		const existingTransactionIds = new Set(existingTransactionRows.map((t) => t.id));
		const transactionIdMap = new Map<string, string>();

		for (const { lineNum, record } of transactionsTable.rows) {
			const txId = record.id;
			if (!txId) {
				skipped++;
				errors.push(`transactions.csv row ${lineNum}: missing id`);
				continue;
			}
			if (transactionIdMap.has(txId)) {
				skipped++;
				errors.push(`transactions.csv row ${lineNum}: duplicate id ${txId}`);
				continue;
			}

			try {
				const mappedAccountId = accountIdMap.get(record.account_id);
				if (!mappedAccountId) {
					throw new Error(`unknown account_id: ${record.account_id || "(empty)"}`);
				}

				let mappedCategoryId: string | null = null;
				if (record.category_id) {
					mappedCategoryId = categoryIdMap.get(record.category_id) ?? null;
					if (!mappedCategoryId) {
						throw new Error(`unknown category_id: ${record.category_id}`);
					}
				}

				const date = parseRequiredDate(record.date ?? "");
				const categorizeOn = parseOptionalDate(record.categorize_on ?? "");
				const counterParty = record.counter_party?.trim();
				if (!counterParty) throw new Error("missing counter_party");
				const currency = parseCurrency(record.currency, "EUR");
				const amountMinor = parseDecimalToMinorUnits(
					parseAmount(record.amount ?? ""),
					await getCurrencyMeta(db, currency),
				);

				const newTxId = existingTransactionIds.has(txId) ? id() : txId;
				await db.exec(
					`insert into transactions
					(id, created_at, updated_at, date, amount_minor, currency, counter_party, additional, notes, categorize_on, category_id, account_id, _sync_edited_at)
					values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						newTxId,
						now,
						now,
						date,
						amountMinor,
						currency,
						counterParty,
						record.additional?.trim() || null,
						record.notes?.trim() || null,
						categorizeOn,
						mappedCategoryId,
						mappedAccountId,
						Date.now(),
					],
				);
				transactionIdMap.set(txId, newTxId);
				existingTransactionIds.add(newTxId);
				transactionsImported++;
			} catch (e: unknown) {
				skipped++;
				errors.push(`transactions.csv row ${lineNum}: ${getErrorMessage(e)}`);
			}
		}

		return {
			imported: transactionsImported,
			skipped,
			errors,
			accounts_imported: accountsImported,
			categories_imported: categoriesImported,
		};
	});
}
