import { Hono } from "hono";

import { getUserId } from "../auth.ts";
import type { Categories } from "../services/categories.ts";

export function categories_v1(categories: Categories) {
	const s = new Hono();

	s.get("", async (c) => {
		const userId = await getUserId(c.req);
		if (!userId) {
			return new Response(null, { status: 401 });
		}

		const query = c.req.query("query");

		const res = await categories.query({
			userId,
			query,
		});

		return c.json(res);
	});

	return s;
}
