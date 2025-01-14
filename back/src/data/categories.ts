import type { Pg } from "./data.ts";
import type { Category } from "./transactions.ts";

export function categories(sql: Pg) {
	return {
		query: async ({ userId, query }: { userId: string; query: string }) => {
			const filter = query ? sql`and lower(c.name) like ${query}` : sql``;

			const rows: Array<Category> = await sql`
				select id, name
				from transaction_categories c
				where c.user_id = ${userId}
				${filter}
				limit 20;
			`;

			return rows;
		},
	};
}
