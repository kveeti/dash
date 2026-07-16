import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

export interface Currency {
  code: string;
  exponent: number;
}

export function useCurrenciesQuery() {
  return useQuery({
    queryKey: ["currencies"],
    queryFn: () => api<Currency[]>("/api/v1/currencies"),
  });
}
