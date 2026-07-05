import { queryOptions } from "@tanstack/solid-query";

import { api } from "./http";

export interface Me {
  id: string;
  email: string;
  home_currency: string;
}

export const meQuery = () =>
  queryOptions({
    queryKey: ["me"],
    queryFn: () => api<Me>("/api/v1/users/@me"),
  });
