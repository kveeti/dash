import { useQuery } from "@tanstack/react-query";

export function useMe() {
	return useQuery({
		queryKey: ["auth"],
		queryFn: async () => {
			const response = await fetch("/api/v1/auth/@me", {
				credentials: "include",
			});
			if (response.status === 401) return null;
			if (response.status !== 200) {
				throw new Error("Error fetching @me");
			}

			const json = await response.json();
			return json as { salt: string };
		},
	});
}
