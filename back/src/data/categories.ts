import type { Pg } from "./data.ts";
import type { CategoryWithTxCount } from "./transactions.ts";

export function categories(sql: Pg) {
	return {
		query: async ({ userId, query }: { userId: string; query: string }) => {
			const filter = query ? sql`and lower(c.name) like ${"%" + query + "%"}` : sql``;

			const rows: Array<CategoryWithTxCount> = await sql`
				select c.id, c.name, count(*) as transaction_count
				from transaction_categories c
				left join transactions t on t.category_id = c.id
				where c.user_id = ${userId}
				${filter}
				group by c.id
				limit 20;
			`;

			return rows;
		},

		update: async (props: { userId: string; id: string; name: string }) => {
			const [row]: Array<{ id: string } | undefined> = await sql`
				update transaction_categories
				set
					name = ${props.name},
					updated_at = now()
				where id = ${props.id}
				and user_id = ${props.userId}
				returning id;
			`;

			return row?.id === props.id;
		},

		delete: async (props: { userId: string; id: string }) => {
			await sql`
				delete from transaction_categories
				where id = ${props.id}
				and user_id = ${props.userId}
			`;
		},
	};
}
