import { TRPCError, initTRPC } from "@trpc/server";
import type { CreateHTTPContextOptions } from "@trpc/server/adapters/standalone";
import SuperJSON from "superjson";

import type { Data } from "./data/data.ts";
import { ids } from "./data/id.ts";
import type { Auth } from "./services/auth.ts";
import { timingSafeEqual, verifyToken } from "./token.ts";

const t = initTRPC.context<Context>().create({ transformer: SuperJSON });
export function createContext(data: Data, services: { auth: Auth }) {
	return (opts: CreateHTTPContextOptions) => ({
		data,
		services,
		...opts,
	});
}
export type Context = Awaited<ReturnType<typeof createContext>>;

export const router = t.router;
export const publicProcedure = t.procedure;

export const authProc = publicProcedure.use(async (opts) => {
	const shouldConsiderCsrf = opts.ctx.info.type === "mutation";
	const cookies = opts.ctx.req.headers.cookie;
	if (!cookies) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
		});
	}

	const csrfCookie = cookies.split("csrf=")?.[1]?.split(";")?.[0];
	if (shouldConsiderCsrf) {
		const csrfHeader = String(opts.ctx.req.headers["x-csrf"]);
		if (
			!csrfCookie ||
			!csrfHeader ||
			!timingSafeEqual(Buffer.from(csrfHeader), Buffer.from(csrfCookie))
		) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "csrf",
			});
		}
	}

	const authCookie = cookies.split("auth=")?.[1]?.split(";")?.[0];
	let userId = await verifyToken(authCookie);
	if (!userId) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "invalid auth",
		});
	}

	userId = userId.slice(ids["user"].length + 1);

	return opts.next({
		ctx: { userId, csrf: csrfCookie },
	});
});
