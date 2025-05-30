import { addDays } from "date-fns";

import type { Data } from "../data/data.ts";
import { id } from "../data/id.ts";
import { passwords } from "../password.ts";
import { createToken } from "../token.ts";

export function auth(data: Data) {
	function getExpiry() {
		return addDays(new Date(), 7);
	}

	return {
		login: async (username: string, password: string) => {
			const user = await data.users.getByUsername(username);
			if (!user) {
				return [null, "user not found"] as const;
			}

			const verifyRes = await passwords.verify(user.password_hash, password);
			if (verifyRes === "failed") {
				return [null, "invalid password"] as const;
			}

			if (verifyRes === "successRehashNeeded") {
				const newHash = await passwords.hash(password);
				await data.users.updatePasswordHash(user.id, newHash);
			}

			const expiry = getExpiry();

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
						preferences: user.preferences,
					},
				},
				null,
			] as const;
		},

		register: async (username: string, password: string) => {
			const userId = id("user");
			const passwordHash = await passwords.hash(password);
			const createdAt = new Date();

			const upserted = await data.users.upsert({
				id: userId,
				username,
				password_hash: passwordHash,
				created_at: createdAt,
			});
			if (!upserted) {
				return [null, "username taken"] as const;
			}

			const expiry = getExpiry();

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
						preferences: undefined,
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
				preferences: user.preferences,
			};
		},

		changePassword: async (props: {
			userId: string;
			oldPassword: string;
			newPassword: string;
		}) => {
			const user = await data.users.getById(props.userId);
			if (!user) throw new Error("no user");

			const verifyRes = await passwords.verify(user.password_hash, props.oldPassword);
			if (verifyRes === "failed") {
				return "invalid password" as const;
			}

			const newHash = await passwords.hash(props.newPassword);

			await data.users.updatePasswordHash(user.id, newHash);
		},
	};
}

export type Auth = ReturnType<typeof auth>;
