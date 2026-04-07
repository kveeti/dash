import type { DbHandle } from "../db";
import { batchHlc } from "../hlc";
import { getMaxHlc } from "./transactions";
import { getOrCreateAccountByName } from "./accounts";
import { getOrCreateCategoryByName } from "./categories";

export type CsvFormat = "generic" | "op";

export type ImportResult = {
	imported: number;
	skipped: number;
	errors: string[];
};

type ParsedTransaction = {
	date: string;
	amount: number;
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
		const msg = cols[9].trim().replace(/^Viesti:/, "").trim();
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

function parseAmount(raw: string): number {
	const cleaned = raw.replace(/[–—]/g, "-").replace(",", ".").trim();
	const n = parseFloat(cleaned);
	if (isNaN(n)) throw new Error(`invalid amount: ${raw}`);
	return n;
}

function parseCsvLine(line: string, delimiter: string): string[] {
	const result: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === delimiter) {
			result.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	result.push(current);
	return result;
}

async function deterministicId(date: string, amount: number, accountId: string, counterParty: string): Promise<string> {
	const input = `${date}|${amount}|${accountId}|${counterParty}`;
	const encoded = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest("SHA-256", encoded);
	const bytes = new Uint8Array(hash);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function importCsv(
	db: DbHandle,
	text: string,
	format: CsvFormat,
	accountName: string,
	currency = "EUR"
): Promise<ImportResult> {
	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	const delimiter = ";";
	const parse = format === "op" ? parseOpRow : parseGenericRow;

	const accountId = await getOrCreateAccountByName(db, accountName);

	let skipped = 0;
	const errors: string[] = [];

	const parsed: { row: ParsedTransaction; lineNum: number }[] = [];
	for (let i = 0; i < lines.length; i++) {
		const cols = parseCsvLine(lines[i], delimiter);
		try {
			parsed.push({ row: parse(cols), lineNum: i + 1 });
		} catch (e: any) {
			if (i === 0) {
				skipped++;
				continue;
			}
			errors.push(`row ${i + 1}: ${e.message}`);
			skipped++;
		}
	}

	const categoryCache = new Map<string, string>();
	const uniqueCategories = new Set(
		parsed.map((p) => p.row.category_name).filter((n): n is string => !!n)
	);
	for (const name of uniqueCategories) {
		categoryCache.set(name, await getOrCreateCategoryByName(db, name));
	}

	const now = new Date().toISOString();
	const hlcs = batchHlc(Date.now(), await getMaxHlc(db), parsed.length);

	// Pre-compute deterministic IDs
	const ids = await Promise.all(
		parsed.map(({ row }) => deterministicId(row.date, row.amount, accountId, row.counter_party))
	);

	const BATCH = 50;
	return db.withTx(async () => {
		for (let i = 0; i < parsed.length; i += BATCH) {
			const batch = parsed.slice(i, i + BATCH);
			const batchIds = ids.slice(i, i + BATCH);
			const batchHlcs = hlcs.slice(i, i + BATCH);
			const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)").join(", ");
			const values = batch.flatMap(({ row }, idx) => [
				batchIds[idx],
				now,
				now,
				row.date,
				row.amount,
				currency,
				row.counter_party,
				row.additional ?? null,
				row.category_name ? categoryCache.get(row.category_name)! : null,
				accountId,
				batchHlcs[idx],
			]);
			await db.exec(
				`insert or ignore into transactions
				 (id, created_at, updated_at, date, amount, currency, counter_party, additional, category_id, account_id, hlc, is_dirty)
				 values ${placeholders}`,
				values
			);
		}
		return { imported: parsed.length, skipped, errors };
	});
}
