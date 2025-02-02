import * as v from "valibot";

import { authProc, router } from "../trpc.ts";

export const users_v1 = router({
	me: authProc.query(async ({ ctx }) => {
		const user = await ctx.services.auth.getUser(ctx.userId);
		if (!user) {
			throw new Error("??");
		}

		return { ...user, csrf: ctx.csrf };
	}),

	updateSettings: authProc
		.input(
			v.parser(
				v.object({
					locale: v.pipe(v.string(), v.nonEmpty("required"), v.maxLength(5)),
				})
			)
		)
		.mutation(async ({ input, ctx }) => {
			await ctx.data.users.setPreferences(ctx.userId, {
				locale: input.locale,
			});

			const user = await ctx.services.auth.getUser(ctx.userId);
			if (!user) {
				throw new Error("??");
			}

			return { ...user, csrf: ctx.csrf };
		}),
});
