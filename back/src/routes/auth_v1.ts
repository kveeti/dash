import { TRPCError } from "@trpc/server";
import * as v from "valibot";

import { id } from "../data/id.ts";
import { createAuthCookie, createCsrfCookie } from "../token.ts";
import { authProc, publicProcedure, router } from "../trpc.ts";

const schema = v.object({
	username: v.pipe(v.string(), v.nonEmpty(), v.maxLength(30)),
	password: v.pipe(v.string(), v.nonEmpty(), v.maxLength(300)),
});

export const auth_v1 = router({
	login: publicProcedure.input(v.parser(schema)).mutation(async ({ input, ctx }) => {
		const [data, err] = await ctx.services.auth.login(input.username, input.password);
		if (err) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "invalid credentials",
			});
		}

		const { token, user } = data;

		const cookie = createAuthCookie(token.value, token.expiry);
		ctx.res.appendHeader("set-cookie", cookie);

		const csrf = id("csrf");
		ctx.res.appendHeader("set-cookie", createCsrfCookie(csrf));

		return { ...user, csrf };
	}),

	register: publicProcedure.input(v.parser(schema)).mutation(async ({ input, ctx }) => {
		const [data, err] = await ctx.services.auth.register(input.username, input.password);
		if (err === "username taken") {
			throw new TRPCError({
				code: "CONFLICT",
				message: "username taken",
			});
		} else if (err) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
			});
		}

		const { token, user } = data;

		const cookie = createAuthCookie(token.value, token.expiry);
		ctx.res.appendHeader("set-cookie", cookie);

		const csrf = id("csrf");
		ctx.res.appendHeader("set-cookie", createCsrfCookie(csrf));

		return { ...user, csrf };
	}),

	logout: publicProcedure.mutation(({ ctx }) => {
		ctx.res.appendHeader("set-cookie", createAuthCookie("", new Date(0)));
		ctx.res.appendHeader("set-cookie", createCsrfCookie(""));
	}),

	changePassword: authProc
		.input(
			v.parser(
				v.object({
					oldPassword: v.string(),
					newPassword: v.string(),
				})
			)
		)
		.mutation(async ({ ctx, input }) => {
			const error = await ctx.services.auth.changePassword({
				userId: ctx.userId,
				oldPassword: input.oldPassword,
				newPassword: input.newPassword,
			});
			if (error === "invalid password")
				throw new TRPCError({ code: "BAD_REQUEST", message: "invalid password" });
		}),
});
