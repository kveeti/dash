import type { InboxFilters } from "../../api/inbox";
import { useSearchParam, useSearchParams } from "../../lib/search-param";
import {
  dateTimestamp,
  rangeDates,
  type DateRange,
} from "../transactions/transaction-filters/date-range";

export function useInboxFilters(): InboxFilters {
  const direction = useSearchParam("direction");
  const amount = useSearchParam("amount");
  const amountMin = useSearchParam("amount_min");
  const amountMax = useSearchParam("amount_max");
  const currency = useSearchParam("currency");
  const accounts = useSearchParams("account");
  const range = (useSearchParam("range") ?? "all-time") as DateRange;
  const customStart = useSearchParam("start");
  const customEnd = useSearchParam("end");
  const dates = rangeDates(range, customStart, customEnd);

  return {
    ...(direction === "in" || direction === "out" ? { direction } : {}),
    ...(amount ? { amount } : {}),
    ...(amountMin ? { amountMin } : {}),
    ...(amountMax ? { amountMax } : {}),
    ...(currency ? { currency } : {}),
    ...(accounts.length ? { accounts } : {}),
    ...(dates.start ? { occurredFrom: dateTimestamp(dates.start) } : {}),
    ...(dates.end ? { occurredBefore: dateTimestamp(dates.end, true) } : {}),
  };
}
