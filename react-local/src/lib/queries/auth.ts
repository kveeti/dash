import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";

export type Me = { salt: string };

async function getMe(): Promise<Me | null> {
	const response = await fetch("/api/v1/auth/@me", {
		credentials: "include",
	});
	if (response.status === 401) return null;
	if (response.status !== 200) {
		throw new Error("Error fetching @me");
	}

	const json = await response.json();
	return json as Me;
}

export function useMe() {
	return useQuery({
		queryKey: queryKeys.auth(),
		queryFn: getMe,
	});
}
