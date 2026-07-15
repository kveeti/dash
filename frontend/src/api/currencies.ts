import { queryOptions } from "@tanstack/solid-query";

import { api } from "./http";

export interface Currency {
  code: string;
  exponent: number;
}

export const currenciesQuery = () =>
  queryOptions({
    queryKey: ["currencies"],
    queryFn: () => api<Currency[]>("/api/v1/currencies"),
  });
