import type { Pg } from "./data.ts";

export const users = (sql: Pg) => ({
	async upsert(user: { id: string; username: string; passwordHash: string; created_at: Date }) {
		const [row] = await sql`
			insert into users
				(id, username, password_hash, created_at)
			values
				(${user.id}, ${user.username}, ${user.passwordHash}, ${user.created_at})
			on conflict (username)
			do nothing
			returning id;
		`;

		return row?.id === user.id;
	},

	async getByUsername(username: string) {
		const [row]: [UserWithPasswordHash?] = await sql`
		      select id, username, password_hash, created_at from users
		      where username = ${username}
		      limit 1;
		`;

		return row;
	},

	async getById(id: string) {
		const [row]: [User?] = await sql`
		      select id, username, created_at from users
		      where id = ${id}
		      limit 1;
		`;

		return row;
	},
});

export type User = {
	id: string;
	username: string;
	created_at: Date;
};

export type UserWithPasswordHash = User & { password_hash: string };
