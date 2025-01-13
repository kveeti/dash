import * as v from "valibot";

import { authProc, router } from "../trpc.ts";

export const categories_v1 = router({
	query: authProc
		.input(
			v.parser(
				v.object({
					query: v.optional(v.string()),
				})
			)
		)
		.query(async ({ ctx, input }) => {
			return await ctx.data.categories.query({
				userId: ctx.userId,
				query: input.query ?? "",
			});
		}),
});
