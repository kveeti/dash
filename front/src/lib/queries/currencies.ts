import { useQuery } from "@tanstack/react-query";
import { useEncrypted } from "../../encrypted-context";
import type { DbHandle } from "../db/client";
import {
	findCurrencyMeta,
	listCurrencyMeta,
} from "../db/currencies";
import { queryKeys } from "./query-keys";

export { findCurrencyMeta };

export function currencyMetaQueryOptions(db: DbHandle) {
	return {
		queryKey: queryKeys.currencyMeta(),
		queryFn: () => listCurrencyMeta(db),
	};
}

export function useCurrencyMetaQuery() {
	const { db } = useEncrypted();
	return useQuery(currencyMetaQueryOptions(db));
}
