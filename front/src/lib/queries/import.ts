import type { DbHandle } from "../db";
import Papa from "papaparse";
import { id } from "../id";
import { getOrCreateCategoryByName } from "./categories";
import { parseCurrency } from "../currency";

export type CsvFormat =
	| "generic"
	| "op"
	| "nordea"
	| "revolut"
	| "legacy_bundle";

export type ImportResult = {
	imported: number;
	skipped: number;
	errors: string[];
	accounts_imported?: number;
	categories_imported?: number;
	links_imported?: number;
};

export type LegacyBundleTexts = {
	transactionsCsv: string;
	accountsCsv: string;
	categoriesCsv: string;
	linksCsv: string;
};

type ParsedTransaction = {
	date: string;
	amount: number;
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
	const fee = feeRaw ? parseAmount(feeRaw) : 0;

	return {
		date: date.toISOString(),
		amount: amount + fee,
		currency: cols[7]?.trim() || undefined,
		counter_party,
		additional: fee !== 0 ? `Fee: ${fee}` : undefined,
	};
}

type ParsedCsvTable = {
	headers: string[];
	rows: Array<{ lineNum: number; record: Record<string, string> }>;
};

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function normalizeHeader(h: string): string {
	return h.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function parseAmount(raw: string): number {
	const cleaned = raw.replace(/[–—]/g, "-").replace(",", ".").trim();
	const n = parseFloat(cleaned);
	if (isNaN(n)) throw new Error(`invalid amount: ${raw}`);
	return n;
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

	const categoryCache = new Map<string, string>();
	const uniqueCategories = new Set(
		parsed.map((p) => p.row.category_name).filter((n): n is string => !!n),
	);
	for (const name of uniqueCategories) {
		categoryCache.set(name, await getOrCreateCategoryByName(db, name));
	}

	const now = new Date().toISOString();
	const BATCH = 50;
	return db.withTx(async () => {
		for (let i = 0; i < parsed.length; i += BATCH) {
			const batch = parsed.slice(i, i + BATCH);
			const placeholders = batch
				.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
				.join(", ");
			const editedAt = Date.now();
			const values = batch.flatMap(({ row }) => [
				id(),
				now,
				now,
				row.date,
				row.amount,
				parseCurrency(row.currency, defaultCurrency),
				row.counter_party,
				row.additional ?? null,
				row.category_name ? categoryCache.get(row.category_name)! : null,
				accountId,
				editedAt,
			]);
			await db.exec(
				`insert into transactions
				 (id, created_at, updated_at, date, amount, currency, counter_party, additional, category_id, account_id, _sync_edited_at)
				 values ${placeholders}`,
				values,
			);
		}
		return { imported: parsed.length, skipped, errors };
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
	const linksTable = parseCsvTable(
		files.linksCsv,
		["transaction_a_id", "transaction_b_id"],
		"links.csv",
	);

	let skipped = 0;
	const errors: string[] = [];

	return db.withTx(async () => {
		const now = new Date().toISOString();
		let accountsImported = 0;
		let categoriesImported = 0;
		let transactionsImported = 0;
		let linksImported = 0;

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
			await db.exec(
				`insert into accounts (id, created_at, updated_at, name, currency, _sync_edited_at)
				values (?, ?, ?, ?, ?, ?)`,
				[newId, now, now, name, currency, Date.now()],
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
				const amount = parseAmount(record.amount ?? "");
				const counterParty = record.counter_party?.trim();
				if (!counterParty) throw new Error("missing counter_party");
				const currency = parseCurrency(record.currency, "EUR");

				const newTxId = existingTransactionIds.has(txId) ? id() : txId;
				await db.exec(
					`insert into transactions
					(id, created_at, updated_at, date, amount, currency, counter_party, additional, notes, categorize_on, category_id, account_id, _sync_edited_at)
					values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						newTxId,
						now,
						now,
						date,
						amount,
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

		const seenLinks = new Set<string>();
		for (const { lineNum, record } of linksTable.rows) {
			const originalA = record.transaction_a_id;
			const originalB = record.transaction_b_id;
			if (!originalA || !originalB) {
				skipped++;
				errors.push(`links.csv row ${lineNum}: missing transaction_a_id or transaction_b_id`);
				continue;
			}

			const mappedA = transactionIdMap.get(originalA);
			const mappedB = transactionIdMap.get(originalB);
			if (!mappedA || !mappedB) {
				skipped++;
				errors.push(
					`links.csv row ${lineNum}: link references missing transaction(s): ${originalA}, ${originalB}`,
				);
				continue;
			}

			if (mappedA === mappedB) {
				skipped++;
				errors.push(`links.csv row ${lineNum}: cannot link transaction to itself`);
				continue;
			}

			const [a, b] = mappedA < mappedB ? [mappedA, mappedB] : [mappedB, mappedA];
			const key = `${a}_${b}`;
			if (seenLinks.has(key)) continue;
			seenLinks.add(key);

			await db.exec(
				`insert into transaction_links
					(transaction_a_id, transaction_b_id, created_at, updated_at, _sync_is_deleted, _sync_status, _sync_edited_at)
				values (?, ?, ?, ?, 0, 1, ?)
				on conflict (transaction_a_id, transaction_b_id) do update set
					_sync_is_deleted = 0,
					updated_at = excluded.updated_at,
					_sync_status = 1,
					_sync_edited_at = excluded._sync_edited_at`,
				[a, b, now, now, Date.now()],
			);
			linksImported++;
		}

		return {
			imported: transactionsImported,
			skipped,
			errors,
			accounts_imported: accountsImported,
			categories_imported: categoriesImported,
			links_imported: linksImported,
		};
	});
}
