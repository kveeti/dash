import type { TransactionFilters } from "../../api/transactions";
import { useSearchParam, useSearchParams } from "../../lib/search-param";
import * as AmountTab from "./transaction-filters/amount-tab";
import * as BankAccountTab from "./transaction-filters/bank-account-tab";
import * as CategoryTab from "./transaction-filters/category-tab";
import {
  dateTimestamp,
  rangeDates,
  type DateRange,
} from "./transaction-filters/date-range";
import * as DateRangeTab from "./transaction-filters/date-range-tab";
import {
  useAccountFilterApplied,
  useAmountFilterApplied,
  useCategoryFilterApplied,
  useDateFilterApplied,
  useTagsFilterApplied,
} from "./transaction-filters/filter-applied";
import {
  FilterButton,
  TabContent,
  TabsList,
} from "./transaction-filters/filter-button";
import * as TagsTab from "./transaction-filters/tags-tab";

export type { DateRange } from "./transaction-filters/date-range";

export function useTransactionFilters(): TransactionFilters {
  const direction = useSearchParam("direction");
  const amount = useSearchParam("amount");
  const amountMin = useSearchParam("amount_min");
  const amountMax = useSearchParam("amount_max");
  const currency = useSearchParam("currency");
  const categories = useSearchParams("category");
  const tags = useSearchParams("tag");
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
    ...(categories.length ? { categories } : {}),
    ...(tags.length ? { tags } : {}),
    ...(accounts.length ? { accounts } : {}),
    ...(dates.start ? { occurredFrom: dateTimestamp(dates.start) } : {}),
    ...(dates.end ? { occurredBefore: dateTimestamp(dates.end, true) } : {}),
  };
}

export function TransactionFiltersButton() {
  const amountApplied = useAmountFilterApplied();
  const categoryApplied = useCategoryFilterApplied();
  const tagsApplied = useTagsFilterApplied();
  const dateApplied = useDateFilterApplied();
  const accountApplied = useAccountFilterApplied();
  const appliedCount =
    Number(amountApplied) +
    Number(categoryApplied) +
    Number(tagsApplied) +
    Number(dateApplied) +
    Number(accountApplied);

  return (
    <FilterButton appliedCount={appliedCount}>
      <TabsList>
        <AmountTab.Trigger applied={amountApplied} />
        <CategoryTab.Trigger applied={categoryApplied} />
        <TagsTab.Trigger applied={tagsApplied} />
        <DateRangeTab.Trigger applied={dateApplied} />
        <BankAccountTab.Trigger applied={accountApplied} />
      </TabsList>
      <TabContent showClear={appliedCount > 0}>
        <AmountTab.Panel />
        <CategoryTab.Panel />
        <TagsTab.Panel />
        <DateRangeTab.Panel />
        <BankAccountTab.Panel />
      </TabContent>
    </FilterButton>
  );
}
