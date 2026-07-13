import { keepPreviousData, queryOptions } from "@tanstack/solid-query";

import { api } from "./http";

export type StatsPeriod = "week" | "month" | "year" | "custom";
export type StatsComparison = "previous" | "year";

export interface StatsQuery {
  period: StatsPeriod;
  compare: StatsComparison;
  today: string;
  timezone: string;
  anchor?: string;
  from?: string;
  to?: string;
}

export interface StatsRange {
  from: string;
  to: string;
}

export interface StatsAmount {
  current: number;
  comparison: number;
  full_comparison?: number;
}

export interface Valuation {
  fallback_transactions: number;
  maximum_fallback_days: number;
  unvalued_currencies: string[];
}

export interface Stats {
  home_currency: string;
  ranges: {
    current: StatsRange;
    comparison: StatsRange;
    full_comparison?: StatsRange;
  };
  summary: {
    expenses: StatsAmount;
    income: StatsAmount;
    net: StatsAmount;
  };
  categories: {
    bucket_id: string;
    current: number;
    comparison: number;
  }[];
  valuation: {
    current: Valuation;
    comparison: Valuation;
    full_comparison?: Valuation;
  };
}

export const statsQuery = (input: StatsQuery) => {
  const query = new URLSearchParams({
    period: input.period,
    compare: input.compare,
    today: input.today,
    timezone: input.timezone,
  });
  if (input.anchor) query.set("anchor", input.anchor);
  if (input.from) query.set("from", input.from);
  if (input.to) query.set("to", input.to);

  return queryOptions({
    queryKey: ["stats", input],
    queryFn: () => api<Stats>(`/api/v1/stats?${query}`),
    placeholderData: keepPreviousData,
  });
};
