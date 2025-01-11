import { Hono } from "hono";
import * as v from "valibot";

import { createAuthCookie, getUserId } from "../auth.ts";
import { envs } from "../envs.ts";
import type { Auth } from "../services/auth.ts";

const schema = v.object({
	username: v.pipe(v.string(), v.nonEmpty()),
	password: v.pipe(v.string(), v.nonEmpty()),
});

export function auth_v1(auth: Auth) {
	const s = new Hono();

	s.post("login", async (c) => {
		const body = await c.req.json();
		if (!v.is(schema, body)) {
			return new Response(null, { status: 400 });
		}

		const [data, err] = await auth.login(body.username, body.password);
		if (err) {
			return c.json({ error: { message: "invalid credentials" } }, { status: 401 });
		}

		const { token, user } = data;

		const cookie = createAuthCookie(token.value, token.expiry, envs.useSecureCookie);
		c.res.headers.set("Set-Cookie", cookie);

		return c.json(user);
	});

	s.post("register", async (c) => {
		const body = await c.req.json();
		if (!v.is(schema, body)) {
			return new Response(null, { status: 400 });
		}

		const [data, err] = await auth.register(body.username, body.password);
		if (err === "username taken") {
			return c.json({ error: { message: "username taken" } }, { status: 409 });
		} else if (err) {
			return c.status(500);
		}

		const { token, user } = data;

		const cookie = createAuthCookie(token.value, token.expiry, envs.useSecureCookie);
		c.res.headers.set("Set-Cookie", cookie);

		return c.json(user, { status: 201 });
	});

	s.post("logout", async (c) => {
		c.res.headers.set("Set-Cookie", createAuthCookie("", new Date(0), envs.useSecureCookie));
		return new Response(null, { status: 204 });
	});

	s.get("@me", async (c) => {
		const userId = await getUserId(c.req);
		if (!userId) {
			return new Response(null, { status: 401 });
		}

		const user = await auth.getUser(userId);
		if (!user) {
			return c.json({ error: { message: "user not found" } }, { status: 400 });
		}

		return c.json(user);
	});

	return s;
}
