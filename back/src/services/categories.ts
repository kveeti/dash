import type { Data } from "../data/data.ts";

export function categories(data: Data) {
	return {
		query: async (opts: { userId: string; query?: string }) => {
			const query = opts.query ? opts.query?.trim().toLowerCase() : "";

			return await data.categories.query({
				userId: opts.userId,
				query,
			});
		},
	};
}

export type Categories = ReturnType<typeof categories>;
