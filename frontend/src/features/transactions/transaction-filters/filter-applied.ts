import { useSearchParam, useSearchParams } from "../../../lib/search-param";

export function useAmountFilterApplied() {
  const direction = useSearchParam("direction");
  const amount = useSearchParam("amount");
  const minimum = useSearchParam("amount_min");
  const maximum = useSearchParam("amount_max");
  return Boolean(direction || amount || minimum || maximum);
}

export function useCategoryFilterApplied() {
  return useSearchParams("category").length > 0;
}

export function useTagsFilterApplied() {
  return useSearchParams("tag").length > 0;
}

export function useDateFilterApplied() {
  const range = useSearchParam("range") ?? "all-time";
  return range !== "all-time";
}

export function useAccountFilterApplied() {
  return useSearchParams("account").length > 0;
}
