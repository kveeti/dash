import { Hono } from "hono";
import * as v from "valibot";

import { getUserId } from "../auth.ts";
import type { Transactions } from "../services/transactions.ts";
import { valibotToHumanUnderstandable } from "../utils.ts";

export function transactions_v1(transactions: Transactions) {
	const s = new Hono();

	s.get("", async (c) => {
		const userId = await getUserId(c.req);
		if (!userId) {
			return new Response(null, { status: 401 });
		}

		const before = c.req.query("before");
		const after = c.req.query("after");
		const limit = c.req.query("limit");

		const res = await transactions.query({
			userId,
			before,
			after,
			limit,
		});

		return c.json(res);
	});

	{
		const schema = v.object({
			counter_party: v.pipe(v.string(), v.nonEmpty()),
			amount: v.pipe(v.number()),
			currency: v.pipe(v.string(), v.nonEmpty()),
			date: v.pipe(
				v.string(),
				v.nonEmpty(),
				v.transform((v) => new Date(v))
			),
			additional: v.nullable(v.string()),
			category_name: v.nullable(v.string()),
		});
		s.post("", async (c) => {
			const userId = await getUserId(c.req);
			if (!userId) {
				return new Response(null, { status: 401 });
			}

			const body = await c.req.json();
			const res = v.safeParse(schema, body);
			if (!res.success) {
				return c.json(
					{
						error: {
							message: "invalid request",
							details: valibotToHumanUnderstandable(res.issues),
						},
					},
					{ status: 400 }
				);
			}

			if (body.category_name) {
				await transactions.createWithCategory({
					userId,
					counterParty: body.counter_party,
					amount: body.amount,
					currency: body.currency,
					date: body.date,
					additional: body.additional,
					categoryName: body.category_name,
				});
			} else {
				await transactions.create({
					userId,
					counterParty: body.counter_party,
					amount: body.amount,
					currency: body.currency,
					date: body.date,
					additional: body.additional,
				});
			}

			return new Response(null, { status: 201 });
		});
	}

	return s;
}
