import { tz } from "@date-fns/tz";
import { eachMonthOfInterval } from "date-fns";

import type { Pg } from "./data.ts";
import { id } from "./id.ts";

export function transactions(sql: Pg) {
	return {
		stats: async ({
			userId,
			start,
			end,
			timezone,
		}: {
			userId: string;
			start: Date;
			end: Date;
			timezone: string;
		}) => {
			// TODO: figure this out purely in SQL
			// atm loads all transactions & related data in specified time range
			// and processes them in memory
			// brute forcing the logic

			const rows = await sql`
select
	t.id as id,
	t.date as date,
	t.amount as amount,
	t.category_id as category_id,
	c.name as cat_name,
	c.is_neutral as cat_is_ne,

	link.id as link_id, 
	link.transaction_a_id as link_transaction_a_id, 
	link.transaction_b_id as link_transaction_b_id,

	linked.id as linked_id,
	linked.amount as linked_amount
from transactions t
left join transactions_links link on link.transaction_a_id = t.id or link.transaction_b_id = t.id
left join transactions linked on (
	link.transaction_b_id = linked.id and link.transaction_a_id = t.id
) or (
	link.transaction_a_id = linked.id and link.transaction_b_id = t.id
)
left join transaction_categories c on t.category_id = c.id
where t.user_id = ${userId}
and t.date at time zone ${timezone} between ${start} and ${end}
and c.is_neutral = false;
`;

			const transactions = {} as {
				[key: string]: {
					id: string;
					period: string;
					amount: number;
					category: {
						id: string;
						name: string;
						is_neutral: boolean;
					} | null;
					links: Array<{
						id: string;
						transaction: {
							id: string;
							amount: number;
						};
					}>;
				};
			};

			// map rows
			for (let i = 0; i < rows.length; i++) {
				const row = rows[i];

				const id = row.id as string;
				const link_id = row.link_id as string;

				let t = transactions[id];

				if (!t) {
					t = {
						id,
						period: (row.date as Date).toISOString().slice(0, 7),
						amount: row.amount as number,
						category: null,
						links: [],
					};

					const categoryId = row.category_id as string | undefined;
					if (categoryId && !t.category) {
						const category_name = row.cat_name as string;
						const is_neutral = row.cat_is_ne as boolean;
						t.category = {
							id: categoryId,
							name: category_name,
							is_neutral,
						};
					}
				}

				if (link_id) {
					const linked_id = row.linked_id as string;
					const hasLink = t.links.find(
						(l) => l.transaction.id === linked_id || l.id === link_id
					);
					if (hasLink) continue;

					const amount = row.linked_amount as number;

					t.links.push({
						id: link_id,
						transaction: {
							id: linked_id,
							amount,
						},
					});
				}

				transactions[id] = t;
			}

			// apply linked transactions
			for (const transaction_id in transactions) {
				const t = transactions[transaction_id];

				if (
					// skip 0 amount transaction, already processed
					t.amount === 0 ||
					// skip neutral categories
					// TODO: maybe show these somehow?
					t.category?.is_neutral
				) {
					continue;
				}

				// negate linked transactions accordingly
				if (t.links.length) {
					if (t.amount > 0) {
						// positive tx
						// go through each negative link "paying"
						// for the linked tx with the positive tx
						// effectively reducing positive tx amount
						// and increasing linked tx amount
						for (let i = 0; i < t.links.length; i++) {
							const link = t.links[i];
							// interested in negative links only
							if (link.transaction.amount > 0) continue;

							const linkedTx = transactions[link.transaction.id];

							const newAmount = Math.max(t.amount + linkedTx.amount, 0);
							const newLinkedAmount = Math.min(linkedTx.amount + t.amount, 0);
							linkedTx.amount = newLinkedAmount;
							link.transaction.amount = newLinkedAmount;

							t.amount = newAmount;
						}

						// above loop is done, `t.amount` is up-to-date
						// update that amount to linked.links
						for (let i = 0; i < t.links.length; i++) {
							const link = t.links[i];
							// interested in negative links only
							if (link.transaction.amount > 0) continue;

							const tx = transactions[link.transaction.id];
							const thisTxLinkIdx = tx.links.findIndex(
								(l) => l.transaction.id == t.id
							);
							tx.links[thisTxLinkIdx].transaction.amount = t.amount;
						}
					}
				}
			}

			const timeframe = eachMonthOfInterval({ start, end }, { in: tz(timezone) });

			const neg_categories = new Set<string>();
			const pos_categories = new Set<string>();

			let total_neg = 0;
			let total_pos = 0;

			type YYYYMM = string;
			type ChartData = {
				__period__: YYYYMM;
				__total_pos__: number;
				__total_neg__: number;
			};
			const period_totals: Record<
				YYYYMM,
				ChartData | ({ [key: string]: number } & ChartData)
			> = {};

			for (const t_id in transactions) {
				const t = transactions[t_id];
				if (t.amount === 0) continue;
				const category_name = t.category?.name ?? "__uncategorized__";

				if (!period_totals[t.period]) {
					period_totals[t.period] = {
						__period__: t.period,
						__total_neg__: 0,
						__total_pos__: 0,
					};
				}

				// @ts-expect-error -- index signature etc
				period_totals[t.period][category_name] =
					// @ts-expect-error -- index signature etc
					(period_totals[t.period][category_name] ?? 0) + t.amount;

				if (t.amount > 0) {
					period_totals[t.period].__total_pos__ += t.amount;
					pos_categories.add(category_name);
					total_pos += t.amount;
				} else {
					period_totals[t.period].__total_neg__ += t.amount;
					neg_categories.add(category_name);
					total_neg += t.amount;
				}
			}

			const chart_data = new Array(timeframe.length);

			for (let i = 0; i < timeframe.length; i++) {
				const p = timeframe[i].toISOString().slice(0, 7);
				chart_data[i] = period_totals[p] ?? {
					__period__: p,
					__total_neg__: 0,
					__total_pos__: 0,
				};
			}

			return {
				totalNeg: total_neg,
				totalPos: total_pos,
				posCategories: [...pos_categories.values()],
				negCategories: [...neg_categories.values()],
				stats: chart_data,
			};
		},

		query: async (opts: {
			userId: string;
			cursor?: { id: string; dir: "left" | "right" };
			limit?: number;
			query?: string;
		}) => {
			const { userId, query } = opts;

			let cursorClause = null;
			let order = sql`desc`;
			const limit = (opts?.limit ?? 50) + 1;
			const cursor = opts?.cursor;

			if (cursor) {
				const { id, dir } = cursor;

				if (dir === "left") {
					order = sql`asc`;
					cursorClause = sql`
					(
						(
							t.date = (select date from transactions where id = ${id})
							and t.id > ${id}
						)
						or t.date > (select date from transactions where id = ${id})
					)`;
				} else if (dir === "right") {
					cursorClause = sql`
					(
						(
							t.date = (select date from transactions where id = ${id})
							and t.id < ${id}
						)
						or t.date < (select date from transactions where id = ${id})
					)`;
				}
			}

			const queryClause = query
				? sql`and t.ts @@ plainto_tsquery('english', ${query})`
				: null;

			const rows = await sql`
				select
					t.id                  as tx_id,
					t.date                as tx_date,
					t.amount	          as tx_amount,
					t.currency            as tx_currency,
					t.additional          as tx_additional,
					t.counter_party       as tx_counter_party,
					t.category_id         as category_id,

					c.name       as cat_name,
					c.is_neutral as cat_is_neutral,

					linked_tx.id            as l_tx_id,
					linked_tx.date          as l_tx_date,
					linked_tx.amount        as l_tx_amount,
					linked_tx.currency      as l_tx_currency,
					linked_tx.additional    as l_tx_additional,
					linked_tx.counter_party as l_tx_counter_party,

					coalesce(tl_a.created_at, tl_b.created_at) as link_created_at,
					coalesce(tl_a.updated_at, tl_b.updated_at) as link_updated_at,
					coalesce(tl_a.id, tl_b.id) as link_id

				from transactions t

				left join transaction_categories c
					on t.category_id = c.id
				left join transactions_links tl_a
					on t.id = tl_a.transaction_a_id
					and tl_a.user_id = t.user_id
				left join transactions_links tl_b
					on t.id = tl_b.transaction_b_id
					and tl_b.user_id = t.user_id
				left join transactions linked_tx
					on (t.id = tl_a.transaction_a_id and linked_tx.id = tl_a.transaction_b_id)
					or (t.id = tl_b.transaction_b_id and linked_tx.id = tl_b.transaction_a_id)

				where t.user_id = ${userId}
				${queryClause ? sql`${queryClause}` : sql``}
				${cursorClause ? sql`and ${cursorClause}` : sql``}
				order by t.date ${order}, t.id ${order}
				limit ${limit};
			`.values();

			const hasMore = rows.length === limit;
			if (hasMore) {
				rows.pop();
			}

			if (cursor?.dir === "left") {
				rows.reverse();
			}

			const transactions = new Map<string, TransactionWithLinks>();

			for (let i = 0; i < rows.length; i++) {
				const row = rows[i];

				const id = row[0] as string;
				const linkedTransactionId = row[9] as string;

				let t = transactions.get(id);

				if (!t) {
					t = {
						id,
						date: row[1] as Date,
						amount: row[2] as number,
						currency: row[3] as string,
						additional: row[4] as string,
						counter_party: row[5] as string,
						category: null,
						links: [],
					};

					const categoryId = row[6] as string | undefined;
					if (categoryId) {
						const categoryName = row[7] as string;
						const is_neutral = row[8] as boolean;
						t.category = {
							id: categoryId,
							name: categoryName,
							is_neutral,
						};
					}
				}

				if (linkedTransactionId) {
					const lDate = row[10] as Date;
					const lAmount = row[11] as number;
					const lCurrency = row[12] as string;
					const lAdditional = row[13] as string;
					const lCounterParty = row[14] as string;
					const linkCreatedAt = row[15] as Date;
					const linkUpdatedAt = row[16] as Date;
					const linkId = row[17] as string;

					t.links.push({
						created_at: linkCreatedAt,
						updated_at: linkUpdatedAt,
						id: linkId,
						transaction: {
							id: linkedTransactionId,
							date: lDate,
							amount: lAmount,
							currency: lCurrency,
							additional: lAdditional,
							counter_party: lCounterParty,
						},
					});
				}

				transactions.set(id, t);
			}

			const list_transactions = [...transactions.values()];

			const lastId = list_transactions.at(-1)?.id;
			const firstId = list_transactions.at(0)?.id;

			let nextId = null;
			let prevId = null;

			if (hasMore && !cursor) {
				nextId = lastId;
			} else if (cursor?.dir === "left" || (hasMore && cursor?.dir === "right")) {
				nextId = lastId;
			}

			if (cursor?.dir === "right" || (hasMore && cursor?.dir === "left")) {
				prevId = firstId;
			}

			return {
				transactions: list_transactions,
				next_id: nextId,
				prev_id: prevId,
			};
		},

		insertWithCategory: async (props: {
			id: string;
			userId: string;
			date: Date;
			amount: number;
			currency: string;
			counterParty: string;
			additional: string | null;
			categoryName: string;
		}) => {
			const categoryId = id("transaction_category");
			await sql`
				with category as (
					insert into transaction_categories (id, name, user_id)
					values (${categoryId}, ${props.categoryName}, ${props.userId})
					on conflict (user_id, lower(name))
					do update set name = excluded.name
					returning id
				)
				insert into transactions (id, date, amount, currency, counter_party, additional, user_id, category_id)
				values (
					${props.id}, 
					${props.date}, 
					${props.amount}, 
					${props.currency}, 
					${props.counterParty}, 
					${props.additional}, 
					${props.userId}, 
					coalesce((select id from category), ${categoryId})
				)
				returning id;
			`;
		},

		insert: async (props: {
			id: string;
			date: Date;
			amount: number;
			currency: string;
			counterParty: string;
			additional: string | null;
			userId: string;
		}) => {
			await sql`
				insert into transactions (id, date, amount, currency, counter_party, additional, user_id)
				values (${props.id}, ${props.date}, ${props.amount}, ${props.currency}, ${props.counterParty}, ${props.additional}, ${props.userId});
			`;
		},

		insertMany: async (
			transactions: Array<{
				id: string;
				date: Date;
				amount: number;
				currency: string;
				counter_party: string;
				additional: string | null;
				user_id: string;
				category_name?: string;
			}>
		) => {
			const uniqueCategories = new Set<string>();
			for (const t of transactions) {
				if (t.category_name) uniqueCategories.add(t.category_name);
			}

			const categoryIds = new Map<string, string>();

			for (const category of uniqueCategories.values()) {
				const c = {
					id: id("transaction_category"),
					name: category,
					user_id: transactions[0].user_id,
				};

				const [{ id: categoryId }]: [{ id: string }] = await sql`
					insert into transaction_categories (id, name, user_id)
					values (${c.id}, ${c.name}, ${c.user_id})
					on conflict (user_id, lower(name))
					do update set name = excluded.name
					returning id;
				`;

				categoryIds.set(category, categoryId);
			}

			const mapped = transactions.map(({ category_name, ...t }) => {
				const category_id = categoryIds.get(category_name ?? "");

				return {
					...t,
					category_id,
				};
			});

			await sql`insert into transactions ${sql(mapped)}`;
		},

		updateWithCategory: async (props: {
			id: string;
			date: Date;
			amount: number;
			currency: string;
			counterParty: string;
			additional: string | null;
			categoryName: string;
			userId: string;
		}) => {
			const categoryId = id("transaction_category");
			await sql`
				with category as (
					insert into transaction_categories (id, name, user_id)
					values (${categoryId}, ${props.categoryName}, ${props.userId})
					on conflict (user_id, lower(name))
					do update set name = excluded.name
					returning id
				)
				update transactions
				set
					date = ${props.date},
					amount = ${props.amount},
					currency = ${props.currency},
					counter_party = ${props.counterParty},
					additional = ${props.additional},
					category_id = coalesce((select id from category), ${categoryId}),
					updated_at = now()
				where id = ${props.id}
				and user_id = ${props.userId};
			`;
		},

		update: async (props: {
			id: string;
			date: Date;
			amount: number;
			currency: string;
			counterParty: string;
			additional: string | null;
			userId: string;
		}) => {
			await sql`
				update transactions
				set
					date = ${props.date},
					amount = ${props.amount},
					currency = ${props.currency},
					counter_party = ${props.counterParty},
					additional = ${props.additional},
					updated_at = now()
				where id = ${props.id}
				and user_id = ${props.userId};
			`;
		},

		async delete(props: { id: string; userId: string }) {
			await sql`
				delete from transactions
				where id = ${props.id}
				and user_id = ${props.userId};
			`;
		},

		link: async (props: { user_id: string; link_id: string; a_id: string; b_id: string }) => {
			await sql`
				insert into transactions_links (id, transaction_a_id, transaction_b_id, user_id)
				values (${props.link_id}, ${props.a_id}, ${props.b_id}, ${props.user_id})
			`;
		},

		unlink: async (props: { user_id: string; link_id: string }) => {
			await sql`
				delete from transactions_links
				where
					user_id = ${props.user_id}
					and id = ${props.link_id}
			`;
		},
	};
}

export type Transaction = {
	id: string;
	date: Date;
	amount: number;
	currency: string;
	additional: string;
	counter_party: string;
};

export type TransactionLink = {
	id: string;
	created_at: Date;
	updated_at: Date | null;
	transaction: Transaction;
};

export type TransactionWithLinks = Transaction & {
	category: Category | null;
	links: TransactionLink[];
};

export type Category = {
	id: string;
	name: string;
	is_neutral: boolean;
};

export type CategoryWithTxCount = Category & {
	transaction_count: bigint;
};
