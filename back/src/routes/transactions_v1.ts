import { addDays, subYears } from "date-fns";
import * as v from "valibot";

import { id } from "../data/id.ts";
import { authProc, router } from "../trpc.ts";

export const transactions_v1 = router({
	stats: authProc
		.input(
			v.parser(
				v.object({
					start: v.date(),
					end: v.date(),
					timezone: v.string(),
					frequency: v.string(),
				})
			)
		)
		.query(async ({ ctx, input }) => {
			return await ctx.data.transactions.stats({
				userId: ctx.userId,
				timezone: input.timezone,
				start: input.start,
				end: input.end,
				frequency: input.frequency as any,
			});
		}),

	query: authProc
		.input(
			v.parser(
				v.object({
					before: v.optional(v.string()),
					after: v.optional(v.string()),
					limit: v.optional(v.number()),
				})
			)
		)
		.query(async ({ ctx, input }) => {
			let cursor = undefined;
			if (input.before) {
				cursor = { id: input.before, dir: "left" as const };
			} else if (input.after) {
				cursor = { id: input.after, dir: "right" as const };
			}
			let limit = 50;
			if (input.limit) {
				const limitNum = input.limit;
				if (limitNum > 0 && limitNum <= 100) {
					limit = limitNum;
				}
			}

			return await ctx.data.transactions.query({
				userId: ctx.userId,
				limit,
				cursor,
			});
		}),

	create: authProc
		.input(
			v.parser(
				v.object({
					counter_party: v.pipe(v.string(), v.nonEmpty("required")),
					amount: v.pipe(v.number("required")),
					currency: v.pipe(v.string(), v.nonEmpty("required")),
					date: v.date(),
					additional: v.nullable(v.string()),
					category_name: v.nullable(v.string()),
				})
			)
		)
		.mutation(async ({ ctx, input }) => {
			if (input.category_name) {
				await ctx.data.transactions.insertWithCategory({
					id: id("transaction"),
					userId: ctx.userId,
					counterParty: input.counter_party,
					amount: input.amount,
					currency: input.currency,
					date: input.date,
					additional: input.additional,
					categoryName: input.category_name,
				});
			} else {
				await ctx.data.transactions.insert({
					id: id("transaction"),
					userId: ctx.userId,
					counterParty: input.counter_party,
					amount: input.amount,
					currency: input.currency,
					date: input.date,
					additional: input.additional,
				});
			}
		}),

	gen: authProc.mutation(async ({ ctx }) => {
		const types = [
			{
				categories: ["groceries"],
				counterParties: ["k-market", "s-market", "lidl"],
				amountRange: [-10, -100],
				frequency: "weekly",
			},
			{
				categories: ["restaurants"],
				counterParties: ["ravintola", "cafe"],
				amountRange: [-20, -60],
				frequency: "weekly",
			},
			{
				categories: ["transport"],
				counterParties: ["osl", "vr", "uber"],
				amountRange: [-10, -50],
				frequency: "weekly",
			},
			{
				categories: ["rent"],
				counterParties: ["landlord"],
				amountRange: [-500, -500],
				frequency: "monthly",
			},
			{
				categories: ["salary"],
				counterParties: ["employer"],
				amountRange: [1800, 2000],
				frequency: "monthly",
			},
		];

		const now = new Date();
		const startDate = subYears(now, 5);

		const frequencies: Record<string, number> = {
			daily: 1,
			weekly: 7,
			monthly: 30,
			yearly: 365,
		};

		let transactions: any[] = [];

		types.forEach((type) => {
			type.categories.forEach((category) => {
				type.counterParties.forEach(async (counterParty) => {
					const amount =
						Math.random() * (type.amountRange[1] - type.amountRange[0]) +
						type.amountRange[0];

					let transactionDate = new Date(startDate);

					while (transactionDate <= now) {
						transactions.push({
							id: id("transaction"),
							user_id: ctx.userId,
							counter_party: counterParty,
							amount,
							currency: "EUR",
							date: new Date(transactionDate),
							category_name: category,
							additional: null,
						});

						transactionDate = addDays(transactionDate, frequencies[type.frequency]);
						if (transactions.length >= 5000) {
							await ctx.data.transactions.insertMany({ transactions });
							transactions = [];
						}
					}
				});
			});
		});

		if (transactions.length > 0) {
			await ctx.data.transactions.insertMany({ transactions });
		}
	}),
});
