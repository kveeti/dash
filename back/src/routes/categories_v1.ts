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

	delete: authProc
		.input(
			v.parser(
				v.object({
					id: v.string(),
				})
			)
		)
		.mutation(async ({ ctx, input }) => {
			await ctx.data.categories.delete({
				id: input.id,
				userId: ctx.userId,
			});
		}),

	edit: authProc
		.input(
			v.parser(
				v.object({
					id: v.string(),
					name: v.pipe(v.string(), v.nonEmpty("required")),
				})
			)
		)
		.mutation(async ({ ctx, input }) => {
			await ctx.data.categories.update({
				id: input.id,
				name: input.name,
				userId: ctx.userId,
			});
		}),
});
