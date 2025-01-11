import { addDays } from "date-fns";

import { createToken, hashPassword, verifyPassword } from "../auth.ts";
import type { Data } from "../data/data.ts";
import { id } from "../data/id.ts";

export function auth(data: Data) {
	return {
		login: async (username: string, password: string) => {
			const user = await data.users.getByUsername(username);
			if (!user) {
				return [null, "user not found"] as const;
			}

			if (!(await verifyPassword(password, user.password_hash))) {
				return [null, "invalid password"] as const;
			}

			const expiry = addDays(new Date(), 1);

			return [
				{
					token: {
						value: await createToken(user.id, expiry),
						expiry,
					},
					user: {
						id: user.id,
						username: user.username,
						created_at: user.created_at,
					},
				},
				null,
			] as const;
		},

		register: async (username: string, password: string) => {
			const userId = id("user");
			const passwordHash = await hashPassword(password);
			const createdAt = new Date();

			const upserted = await data.users.upsert({
				id: userId,
				username,
				passwordHash,
				created_at: createdAt,
			});
			if (!upserted) {
				return [null, "username taken"] as const;
			}

			const expiry = addDays(new Date(), 1);

			return [
				{
					token: {
						value: await createToken(userId, expiry),
						expiry,
					},
					user: {
						id: userId,
						username: username,
						created_at: createdAt,
					},
				},
				null,
			] as const;
		},

		getUser: async (userId: string) => {
			const user = await data.users.getById(userId);
			if (!user) {
				return null;
			}

			return {
				id: user.id,
				username: user.username,
				created_at: user.created_at,
			};
		},
	};
}

export type Auth = ReturnType<typeof auth>;
