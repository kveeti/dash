import { useMemo } from "react";

import { useDebouncedValue } from "./use-debounced-value";

interface AmountFilters {
  amount?: string;
  amountMin?: string;
  amountMax?: string;
  currency?: string;
}

export function useDebouncedAmountFilters<T extends AmountFilters>(filters: T) {
  const amounts = useMemo(
    () => ({
      amount: filters.amount,
      amountMin: filters.amountMin,
      amountMax: filters.amountMax,
      currency: filters.currency,
    }),
    [filters.amount, filters.amountMin, filters.amountMax, filters.currency],
  );
  const debouncedAmounts = useDebouncedValue(amounts, 150);
  return { ...filters, ...debouncedAmounts };
}
