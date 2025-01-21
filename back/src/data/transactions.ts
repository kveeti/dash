import type { Pg } from "./data.ts";
import { id } from "./id.ts";

export function transactions(sql: Pg) {
	return {
		stats: async ({
			userId,
			start,
			end,
			timezone,
			frequency,
		}: {
			userId: string;
			start: Date;
			end: Date;
			timezone: string;
			frequency: "monthly" | "yearly";
		}) => {
			const period =
				frequency === "monthly"
					? sql`date_trunc('month', t.date at time zone ${timezone})`
					: sql`date_trunc('year', t.date at time zone ${timezone})`;

			const rows = await sql`
				with period_series as (
					select generate_series(
						date_trunc('month', ${start} at time zone ${timezone}),
						date_trunc('month', ${end} at time zone ${timezone}),
						interval '1 month'
					) as period
				),
				processed_transactions as (
					select
						${period} as period,
						sum(t.amount) as total,
						coalesce(sum(case when t.amount > 0 then t.amount else 0 end), 0) as total_pos,
						coalesce(sum(case when t.amount < 0 then t.amount else 0 end), 0) as total_neg,
						coalesce(c.name, '__uncategorized__') as category_name
					from transactions t
					left join transaction_categories c
						on t.category_id = c.id
					where t.user_id = ${userId}
						and t.date at time zone ${timezone} >= ${start}
						and t.date at time zone ${timezone} <= ${end}
					group by period, category_name
				)
				select
					ps.period,
					json_object_agg(category_name, total) filter (where category_name is not null) as categories,
					sum(total_pos),
					sum(total_neg)
				from period_series ps
				left join processed_transactions pt
					on ps.period = pt.period
				group by ps.period
				order by ps.period;
			`.values();

			// produces:
			// [
			//   "2021-01-01T00:00:00.000Z",
			//   {
			//     "{category}": {total},
			//     "{category}": {total},
			//   },
			//   {totalPos},
			//   {totalNeg},
			//   {total}
			// ]

			const uniqueNegativeCategories = new Set<string>();
			const uniquePositiveCategories = new Set<string>();

			let totalPos = 0;
			let totalNeg = 0;

			const resolved = rows.map((row) => {
				const period = row[0];
				const categories = row[1];
				const _totalPos = row[2];
				const _totalNeg = row[3];

				totalPos += _totalPos;
				totalNeg += _totalNeg;

				if (categories) {
					const categoryNames = Object.keys(categories);
					for (let i = 0; i < categoryNames.length; i++) {
						const cat = categoryNames[i];
						const amount = categories[cat];
						if (amount > 0) {
							uniquePositiveCategories.add(cat);
						} else {
							uniqueNegativeCategories.add(cat);
						}
					}
				}

				return {
					__period__: period,
					...categories,
				};
			});

			return {
				stats: resolved,
				totalNeg,
				totalPos,
				negCategories: [...uniqueNegativeCategories],
				posCategories: [...uniquePositiveCategories],
			};
		},

		query: async (opts: {
			userId: string;
			cursor?: { id: string; dir: "left" | "right" };
			limit?: number;
		}) => {
			const { userId } = opts;

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
					)
					`;
				} else if (dir === "right") {
					cursorClause = sql`
					(
						(
							t.date = (select date from transactions where id = ${id})
							and t.id < ${id}
						)
						or t.date < (select date from transactions where id = ${id})
					)
					`;
				}
			}

			const rows = await sql`
				select
					t.id            as tx_id,
					t.date          as tx_date,
					t.amount        as tx_amount,
					t.currency      as tx_currency,
					t.additional    as tx_additional,
					t.counter_party as tx_counter_party,
					t.category_id   as category_id,
					c.name          as category_name,

					linked_tx.id            as l_tx_id,
					linked_tx.date          as l_tx_date,
					linked_tx.amount        as l_tx_amount,
					linked_tx.currency      as l_tx_currency,
					linked_tx.additional    as l_tx_additional,
					linked_tx.counter_party as l_tx_counter_party,

					coalesce(tl_a.created_at, tl_b.created_at) as_link_created_at

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
				const row = rows[i]!;

				const id = row[0];
				const linkId = row[8];

				let t = transactions.get(id);

				if (!t) {
					t = {
						id,
						date: row[1],
						amount: row[2],
						currency: row[3],
						additional: row[4],
						counter_party: row[5],
						category: null,
						links: [],
					};

					const categoryId = row[6];
					if (categoryId) {
						const categoryName = row[7];
						t.category = {
							id: categoryId,
							name: categoryName,
						};
					}
				}

				if (linkId) {
					const lDate = row[9];
					const lAmount = row[10];
					const lCurrency = row[11];
					const lAdditional = row[12];
					const lCounterParty = row[13];

					t.links.push({
						id: linkId,
						date: lDate,
						amount: lAmount,
						currency: lCurrency,
						additional: lAdditional,
						counter_party: lCounterParty,
					});
				}

				transactions.set(id, t);
			}

			const lastId = rows.at(-1)?.tx_id;
			const firstId = rows.at(0)?.tx_id;

			let nextId = null;
			let prevId = null;

			if (hasMore && !cursor) {
				nextId = lastId;
			} else if (cursor) {
				nextId = lastId;
				prevId = firstId;
			}

			return {
				transactions: Array.from(transactions.values()),
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

		insertMany: async (props: {
			transactions: Array<{
				id: string;
				date: Date;
				amount: number;
				currency: string;
				counter_party: string;
				additional: string | null;
				user_id: string;
				category_name: string;
			}>;
		}) => {
			const uniqueCategories = new Set<string>();
			for (const t of props.transactions) {
				uniqueCategories.add(t.category_name);
			}

			const categoryIds = new Map<string, string>();

			for (const category of uniqueCategories.values()) {
				const c = {
					id: id("transaction_category"),
					name: category,
					user_id: props.transactions[0].user_id,
				};

				const [{ id: categoryId }] = await sql`
					insert into transaction_categories (id, name, user_id)
					values (${c.id}, ${c.name}, ${c.user_id})
					on conflict (user_id, lower(name))
					do update set name = excluded.name
					returning id;
				`;

				categoryIds.set(category, categoryId);
			}

			const transactions = props.transactions.map(({ category_name, ...t }) => {
				const category_id = categoryIds.get(category_name);

				return {
					...t,
					category_id,
				};
			});

			await sql`insert into transactions ${sql(transactions)}`;
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
					category_id = coalesce((select id from category), ${categoryId})
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
					additional = ${props.additional}
				where id = ${props.id}
				and user_id = ${props.userId};
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

export type TransactionWithLinks = Transaction & {
	category: Category | null;
	links: Transaction[];
};

export type Category = {
	id: string;
	name: string;
};

export type CategoryWithTxCount = Category & {
	transaction_count: bigint;
};
