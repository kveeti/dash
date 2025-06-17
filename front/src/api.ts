import { useQuery, useQueryClient } from "@tanstack/react-query";
import createFetchClient from "openapi-fetch";
import createClient from "openapi-react-query";

import type { paths } from "./api_types.d.ts";
import { things } from "./things.ts";

type Me = paths["/v1/@me"]["get"]["responses"]["200"]["content"]["application/json"];
const win = window as unknown as {
	__ME_LOADER__: {
		promise: Promise<Me> | null;
		data: Me | null;
	};
};

export const fetchClient = createFetchClient<paths>({
	baseUrl: things.apiBase,
	credentials: "include",
});

export let csrf: string | undefined = undefined;

fetchClient.use({
	onRequest: ({ request }) => {
		if ("GET" !== request.method && csrf) {
			const _csrf = csrf || lsGetJson("me")?.csrf;
			request.headers.set("x-csrf", _csrf);
		}
		return request;
	},
});
export const api = createClient(fetchClient);

export function useMeQuery() {
	return useQuery({
		queryKey: ["me"],
		queryFn: async () => {
			let data = null;
			if (win.__ME_LOADER__.promise) {
				data = await win.__ME_LOADER__.promise;
			}

			data = win.__ME_LOADER__.data;

			csrf = data?.csrf;

			return data;
		},
		initialData: () => lsGetJson("me") as Me | null,
	});
}

function lsGetJson(key: string) {
	let value = null;
	try {
		const item = localStorage.getItem(key);
		if (!item) return;
		value = JSON.parse(item);
	} catch {}

	return value;
}

export function useMe() {
	return useMeQuery().data!;
}

export function useSetMe() {
	const qc = useQueryClient();

	return (me: Me | undefined) => {
		qc.setQueryData(["me"], () => {
			return me;
		});
	};
}
