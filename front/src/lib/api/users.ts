import { useQuery } from "@tanstack/react-query";

import { type ApiError, apiRequest } from "./api";

type Me = {
	id: string;
	username: string;
	csrf_token: string;
};

// @ts-expect-error -- index.html
const s = window.__STUFF__ as {
	data: null | Me;
	promise: Promise<Me> | null;
};

export function useMe() {
	console.log(s);
	return useQuery<{ id: string; username: string; csrf_token: string }, ApiError>({
		initialData: s.data || undefined,
		retryOnMount: false,
		staleTime: 10000,
		queryKey: ["@me"],
		queryFn: async () => {
			if (s.promise) {
				return await s.promise;
			}

			return apiRequest({ path: "/v1/auth/@me" });
		},
		retry(_, error) {
			return error.status !== 401; // don't retry if unauthorized
		},
	});
}
