import {
	fallbackCurrencyMeta,
	normalizeCurrency,
	type CurrencyMeta,
} from "../currency";
import type { DbHandle } from "./client";

export async function listCurrencyMeta(db: DbHandle): Promise<CurrencyMeta[]> {
	return db.query<CurrencyMeta>(
		`select currency, minor_unit, minor_factor from currency_meta order by currency asc`,
	);
}

export function findCurrencyMeta(
	rows: CurrencyMeta[] | undefined,
	currency: string,
): CurrencyMeta {
	const normalized = normalizeCurrency(currency);
	return (
		rows?.find((meta) => meta.currency === normalized) ??
		fallbackCurrencyMeta(normalized)
	);
}
