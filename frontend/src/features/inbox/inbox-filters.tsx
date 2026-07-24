import * as AmountTab from "../transactions/transaction-filters/amount-tab";
import * as BankAccountTab from "../transactions/transaction-filters/bank-account-tab";
import * as DateRangeTab from "../transactions/transaction-filters/date-range-tab";
import {
  useAccountFilterApplied,
  useAmountFilterApplied,
  useDateFilterApplied,
} from "../transactions/transaction-filters/filter-applied";
import {
  FilterButton,
  TabContent,
  TabsList,
} from "../transactions/transaction-filters/filter-button";

export function InboxFiltersButton() {
  const amountApplied = useAmountFilterApplied();
  const dateApplied = useDateFilterApplied();
  const accountApplied = useAccountFilterApplied();
  const appliedCount =
    Number(amountApplied) + Number(dateApplied) + Number(accountApplied);

  return (
    <FilterButton appliedCount={appliedCount}>
      <TabsList>
        <AmountTab.Trigger applied={amountApplied} />
        <DateRangeTab.Trigger applied={dateApplied} />
        <BankAccountTab.Trigger applied={accountApplied} />
      </TabsList>
      <TabContent showClear={appliedCount > 0}>
        <AmountTab.Panel />
        <DateRangeTab.Panel />
        <BankAccountTab.Panel />
      </TabContent>
    </FilterButton>
  );
}
