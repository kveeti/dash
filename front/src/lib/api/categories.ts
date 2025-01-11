import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiRequest } from "./api";

export function useCategories(searchQuery: string) {
	return useQuery({
		queryKey: ["categories", searchQuery],
		queryFn: () =>
			apiRequest<Array<{ id: string; name: string }>>({
				path: "/v1/categories",
				query: { query: searchQuery },
			}),
		placeholderData: keepPreviousData,
	});
}
