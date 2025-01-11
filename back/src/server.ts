import { type ServerType, serve } from "@hono/node-server";
import { Hono } from "hono";

import type { Data } from "./data/data.ts";
import { auth_v1 } from "./routes/auth_v1.ts";
import { categories_v1 } from "./routes/categories_v1.ts";
import { transactions_v1 } from "./routes/transactions_v1.ts";
import { type Auth, auth } from "./services/auth.ts";
import { categories } from "./services/categories.ts";
import { transactions } from "./services/transactions.ts";

export function createServer({ port, data }: { port: number; data: Data }) {
	const hono = new Hono();

	hono.use(async (c, next) => {
		c.res.headers.set("Access-Control-Allow-Origin", "http://localhost:3000");
		c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
		c.res.headers.set("Access-Control-Allow-Headers", "Content-Type");
		c.res.headers.set("Access-Control-Allow-Credentials", "true");

		const isPreflight = c.req.method === "OPTIONS";
		if (isPreflight) {
			return new Response(null, {
				headers: c.res.headers,
				status: 204,
			});
		}

		await next();
	});

	const s_auth = auth(data);
	const s_categories = categories(data);
	const s_transactions = transactions(data);

	hono.route("/api/v1/auth", auth_v1(s_auth));
	hono.route("/api/v1/transactions", transactions_v1(s_transactions));
	hono.route("/api/v1/categories", categories_v1(s_categories));

	let server: ServerType | null = null;

	return {
		start: () => {
			server = serve({ fetch: hono.fetch, port }, () => {
				console.log(`listening on port ${port}`);
			});
		},
		close: async () => {
			if (server) {
				server.close();
			}
			await data.close();
		},
	};
}

function routes(hono: Hono, auth: Auth) {}
