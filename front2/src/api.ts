import createFetchClient from "openapi-fetch";
import createClient from "openapi-react-query";
import type { paths } from "./api_types.d.ts";
import { useQuery } from "@tanstack/react-query";

type Me =
	paths["/@me"]["get"]["responses"]["200"]["content"]["application/json"];
const win = window as unknown as {
	__ME_LOADER__: {
		promise: Promise<Me> | null;
		data: Me | null;
	};
};

const fetchClient = createFetchClient<paths>({
	baseUrl: "http://localhost:8000/api",
	credentials: "include",
});
export const api = createClient(fetchClient);

export function useMe() {
	return useQuery({
		queryKey: ["me"],
		queryFn: async () => {
			if (win.__ME_LOADER__.promise) {
				return await win.__ME_LOADER__.promise;
			}

			return win.__ME_LOADER__.data;
		},
		initialData: () => JSON.parse(localStorage.getItem("me")!),
	});
}
