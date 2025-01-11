import type { Data } from "../data/data.ts";
import { id } from "../data/id.ts";

export function transactions(data: Data) {
	return {
		query: async (opts: {
			userId: string;
			before?: string;
			after?: string;
			limit?: string;
		}) => {
			let cursor = undefined;
			if (opts.before) {
				cursor = { id: opts.before, dir: "left" as const };
			} else if (opts.after) {
				cursor = { id: opts.after, dir: "right" as const };
			}
			let limit = 50;
			if (opts.limit) {
				const limitNum = parseInt(opts.limit);
				if (limitNum > 0 && limitNum <= 100) {
					limit = limitNum;
				}
			}

			return await data.transactions.query({
				userId: opts.userId,
				cursor,
				limit,
			});
		},

		createWithCategory: async (props: {
			userId: string;
			date: string;
			amount: number;
			currency: string;
			counterParty: string;
			additional: string | null;
			categoryName: string;
		}) => {
			await data.transactions.insertWithCategory({
				userId: props.userId,
				id: id("transaction"),
				date: props.date,
				amount: props.amount,
				currency: props.currency,
				counterParty: props.counterParty,
				additional: props.additional,
				categoryName: props.categoryName,
			});
		},

		create: async (props: {
			userId: string;
			date: string;
			amount: number;
			currency: string;
			counterParty: string;
			additional: string | null;
		}) => {
			await data.transactions.insert({
				userId: props.userId,
				id: id("transaction"),
				date: props.date,
				amount: props.amount,
				currency: props.currency,
				counterParty: props.counterParty,
				additional: props.additional,
			});
		},
	};
}

export type Transactions = ReturnType<typeof transactions>;
