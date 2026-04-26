import { useQuery } from "@tanstack/react-query";
import { useDb } from "../../providers";
import type { CurrencyMeta } from "../currency";
import { queryKeys } from "./query-keys";

export function useCurrencyMetaQuery() {
	const db = useDb();
	return useQuery({
		queryKey: queryKeys.currencyMeta(),
		queryFn: () =>
			db.query<CurrencyMeta>(
				`select currency, minor_unit, minor_factor from currency_meta order by currency asc`,
			),
	});
}
