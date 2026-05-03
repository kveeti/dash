import { useQuery } from "@tanstack/react-query";
import { useEncrypted } from "../../encrypted-context";
import type { CurrencyMeta } from "../currency";
import { queryKeys } from "./query-keys";

export function useCurrencyMetaQuery() {
	const { db } = useEncrypted();
	return useQuery({
		queryKey: queryKeys.currencyMeta(),
		queryFn: () =>
			db.query<CurrencyMeta>(
				`select currency, minor_unit, minor_factor from currency_meta order by currency asc`,
			),
	});
}
