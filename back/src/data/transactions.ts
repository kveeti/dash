import type { Pg } from "./data.ts";

export function transactions(sql: Pg) {
	return {
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
			date: string;
			amount: number;
			currency: string;
			counterParty: string;
			additional: string | null;
			categoryName: string;
			userId: string;
		}) => {
			const category_id = await sql.begin(async (sql) => {
				const [{ id: category_id }]: [{ id: string }] = await sql`
					insert into transaction_categories (id, name, user_id)
					values (
						(
							select id from transaction_categories 
							where name = ${props.categoryName}
							and user_id = ${props.userId}
						),
						${props.categoryName},
						${props.userId}
					)
					returning id;
				`;

				await sql`
					insert into transactions (id, date, amount, currency, counter_party, additional, user_id, category_id)
					values (${props.id}, ${props.date}, ${props.amount}, ${props.currency}, ${props.counterParty}, ${props.additional}, ${props.userId}, ${category_id});
				`;

				return category_id;
			});

			return { category_id };
		},

		insert: async (props: {
			id: string;
			date: string;
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
	};
}

export type Transaction = {
	id: string;
	date: string;
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
