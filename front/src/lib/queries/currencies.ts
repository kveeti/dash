import { useQuery } from "@tanstack/react-query";
import { useEncrypted } from "../../encrypted-context";
import type { DbHandle } from "../db";
import {
	fallbackCurrencyMeta,
	normalizeCurrency,
	type CurrencyMeta,
} from "../currency";
import { queryKeys } from "./query-keys";

export function currencyMetaQueryOptions(db: DbHandle) {
	return {
		queryKey: queryKeys.currencyMeta(),
		queryFn: () =>
			db.query<CurrencyMeta>(
				`select currency, minor_unit, minor_factor from currency_meta order by currency asc`,
			),
	};
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

export function useCurrencyMetaQuery() {
	const { db } = useEncrypted();
	return useQuery(currencyMetaQueryOptions(db));
}
