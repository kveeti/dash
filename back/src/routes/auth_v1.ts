import { TRPCError } from "@trpc/server";
import * as v from "valibot";

import { createAuthCookie } from "../auth.ts";
import { envs } from "../envs.ts";
import { authProc, publicProcedure, router } from "../trpc.ts";

const schema = v.object({
	username: v.pipe(v.string(), v.nonEmpty()),
	password: v.pipe(v.string(), v.nonEmpty()),
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

		const cookie = createAuthCookie(token.value, token.expiry, envs.useSecureCookie);
		ctx.res.appendHeader("set-cookie", cookie);

		return user;
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

		const cookie = createAuthCookie(token.value, token.expiry, envs.useSecureCookie);
		ctx.res.appendHeader("set-cookie", cookie);

		return user;
	}),

	logout: publicProcedure.mutation(async ({ ctx }) => {
		ctx.res.appendHeader("set-cookie", createAuthCookie("", new Date(0), envs.useSecureCookie));
	}),

	me: authProc.query(async ({ ctx }) => {
		const user = await ctx.services.auth.getUser(ctx.userId);
		if (!user) {
			throw new Error("??");
		}

		return user;
	}),
});
