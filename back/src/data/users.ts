import type { Pg } from "./data.ts";

export const users = (sql: Pg) => ({
	async upsert(user: User) {
		const [row] = await sql`
			insert into users
				(id, username, password_hash, created_at)
			values
				(${user.id}, ${user.username}, ${user.password_hash}, ${user.created_at})
			on conflict (username)
			do nothing
			returning id;
		`;

		return row?.id === user.id;
	},

	async getByUsername(username: string) {
		const [row]: [
			{
				id: string;
				username: string;
				created_at: Date;
				password_hash: string;
				pre_locale: string;
			}?,
		] = await sql`
			select
				u.id,
				u.username,
				u.created_at,
				u.password_hash,
				up.locale as pre_locale
			from users u
			left join user_preferences up on u.id = up.user_id
			where u.username = ${username}
			limit 1;
		`;

		if (!row) {
			return null;
		}

		const user: UserWithPreferences = {
			id: row.id,
			username: row.username,
			created_at: row.created_at,
			password_hash: row.password_hash,
			preferences: {
				locale: row.pre_locale,
			},
		};

		return user;
	},

	async getById(id: string) {
		const [row]: [
			{
				id: string;
				username: string;
				created_at: Date;
				password_hash: string;
				pre_locale: string;
			}?,
		] = await sql`
			select
				u.id,
				u.username,
				u.created_at,
				u.password_hash,
				up.locale as pre_locale
			from users u
			left join user_preferences up on u.id = up.user_id
			where u.id = ${id}
			limit 1;
		`;

		if (!row) {
			return null;
		}

		const user: UserWithPreferences = {
			id: row.id,
			username: row.username,
			created_at: row.created_at,
			password_hash: row.password_hash,
			preferences: {
				locale: row.pre_locale,
			},
		};

		return user;
	},

	async updatePasswordHash(userId: string, newPasswordHash: string) {
		await sql`
			update users
			set password_hash = ${newPasswordHash}
			where id = ${userId};
		`;
	},

	async setPreferences(
		userId: string,
		preferences: {
			locale: string;
		}
	) {
		await sql`
			insert into user_preferences (user_id, locale)
			values (${userId}, ${preferences.locale})
			on conflict (user_id)
			do update set locale = ${preferences.locale};
		`;
	},
});

export type UserPreferences = {
	locale: string;
};

export type User = {
	id: string;
	username: string;
	password_hash: string;
	created_at: Date;
};

export type UserWithPreferences = User & { preferences?: UserPreferences };
