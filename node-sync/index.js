import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import postgres from "postgres";

const isProd = process.env.NODE_ENV === "production";

async function main() {
	const config = {
		front_base_url: "http://localhost:3000",
		port: 8000,
		db_url: "postgres://postgres:postgres@localhost:5556/postgres",
	};

	console.log("connecting to db...");
	const pg = postgres(config.db_url);
	await pg`select 1`;
	console.log("migrating db...");
	await migrate(pg);

	console.log("starting server...");
	const app = new Hono();
	app.use(
		cors({
			origin: config.front_base_url,
			allowHeaders: ["Content-Type"],
			allowMethods: ["GET", "POST", "OPTIONS"],
			credentials: true,
		}),
	);

	async function getServerMaxVersion({ userId }) {
		const rows = await pg`
			select max(_sync_server_version) as max_server_version
			from entries
			where user_id = ${userId};
		`;
		return rows?.[0]?.max_server_version || 0;
	}

	let SUB_ID = BigInt(0n);
	const subs = new Map();
	function registerCallback(userId, subId, callback) {
		const usersSubs = subs.get(userId);
		if (!usersSubs) {
			const newUsersSubs = new Map([[subId, callback]]);
			subs.set(userId, newUsersSubs);
		} else {
			usersSubs?.set(subId, callback);
		}

		return subId;
	}
	function removeCallback(userId, subId) {
		const userSubs = subs.get(userId);
		if (!userSubs) return;

		userSubs.delete(subId);

		if (userSubs.size === 0) {
			subs.delete(userId);
		}
	}
	function poke(userId, fromSubId) {
		if (!fromSubId) return;

		const userSubs = subs.get(userId);
		if (userSubs) {
			userSubs.forEach((callback, subId) => {
				if (subId === fromSubId) return;
				callback().catch((err) => console.error("Poke failed:", err));
			});
		}
	}
	app.get("/api/v1/sub", async (c) => {
		const userId = c.req.query("user_id");
		if (!userId) return c.body("Missing 'user_id'", 400);

		const subIdCookie = getCookie(c, "sub_id");
		const subId = subIdCookie ? BigInt(subIdCookie) : SUB_ID++;

		return streamSSE(c, async (stream) => {
			registerCallback(userId, subId, async () => {
				await stream.writeSSE({
					data: "poke!",
				});
			});
			stream.onAbort(() => removeCallback(userId, subId));

			await stream.writeSSE({
				data: "hi!",
			});

			while (true) {
				await stream.sleep(15000 /* ms */);
				await stream.writeSSE({
					data: "hb",
				});
			}
		});
	});

	app.get("/api/v1/pull", async (c) => {
		const { user_id: userId, cursor, limit: reqLimit } = c.req.query();
		if (!userId) {
			return c.body("Missing 'user_id'", 400);
		}

		const currentMaxCursor = await getServerMaxVersion({ userId });
		if (cursor > currentMaxCursor) {
			// Client has bigger cursor than server max.
			// Demand client to push all its stuff
			return c.json({ error: "cursor_gt_max" }, 409);
		}

		const limit = !reqLimit || reqLimit > 1000 ? 1000 : reqLimit;

		const rows = await pg`
			select id, _sync_hlc, blob, _sync_is_deleted, _sync_server_version
			from entries
			where user_id = ${userId}
				and _sync_server_version > ${cursor}
			order by _sync_server_version asc
			limit ${limit + 1};
		`;

		let nextCursor;
		if (rows.length === limit + 1) {
			nextCursor = rows.at(-1)?._sync_server_version;
			rows.pop();
		}

		const highestVersion = rows.at(-1)?._sync_server_version;

		return c.json({
			entries: rows.map((r) => ({
				id: r.id,
				_sync_hlc: r._sync_hlc,
				blob: encodeBase64(r.blob),
				_sync_is_deleted: r._sync_is_deleted,
			})),
			next_cursor: nextCursor,
			highest_version: highestVersion,
		});
	});

	app.post("/api/v1/push", async (c) => {
		const { user_id: userId } = c.req.query();
		if (!userId) {
			return c.body("Missing 'user_id'", 400);
		}

		const entries = await c.req.json();
		if (!entries?.length) {
			return c.body("Missing 'entries'", 400);
		}

		await pg`
			insert into entries ${pg(
				entries.map((e) => ({
					user_id: userId,
					id: e.id,
					_sync_hlc: e._sync_hlc,
					blob: decodeBase64(e.blob),
					_sync_is_deleted: e._sync_is_deleted,
				})),
			)}
			on conflict (user_id, id)
			do update set 
				_sync_hlc = excluded._sync_hlc,
				blob = excluded.blob,
				_sync_is_deleted = excluded._sync_is_Deleted
			where excluded._sync_hlc > entries._sync_hlc;
		`;

		const newCursor = await getServerMaxVersion({ userId });

		poke(userId, BigInt(getCookie(c, "sub_id")));

		return c.json({
			new_cursor: newCursor,
		});
	});

	app.post("/api/v1/handshake", async (c) => {
		let json;
		try {
			json = await c.req.json();
		} catch (e) {}

		let userId = json?.user_id;
		let salt = null;
		if (userId) {
			const row = await pg`
				select salt from users
				where id = ${userId}
			`;
			salt = row?.salt;
		}

		if (!userId || !salt) {
			// salt = encodeBase64(crypto.getRandomValues(new Uint8Array(16)));
			salt = "vL8a9xN2+P5zQ/1rK4wJnA==";
			userId = "01KNTDAGHZABZESEE56CBTJMVH";
			try {
				await pg`
					insert into users (id, salt)
					values (${userId}, ${salt})
				`;
			} catch (e) {}
		}

		setCookie(c, "sub_id", String(++SUB_ID), {
			httpOnly: true,
			sameSite: "lax",
		});

		return c.json({
			user_id: userId,
			salt,
		});
	});

	app.get("/api", async (c) => {
		return c.body("Hello, world!");
	});

	const server = serve(
		{
			fetch: app.fetch,
			port: config.port,
		},
		(addr) => console.log(`listening at ${addr.port}`),
	);

	if (isProd) {
		process.on("SIGINT", () => {
			server.close();
			process.exit(0);
		});
		process.on("SIGTERM", () => {
			const t = setTimeout(() => process.exit(1), 5000);
			server.close((err) => {
				if (err) {
					console.error(err);
					process.exit(1);
				}
				process.exit(0);
			});
		});
	}
}

async function migrate(pg) {
	await pg`create table if not exists version (current integer not null);`;

	const migrations = [
		// -- entries --
		`create table entries (
			id text primary key not null,
			blob bytea not null,
			user_id text not null,

			_sync_is_deleted boolean not null default false,
			_sync_hlc text not null,
			_sync_server_version bigint not null,
			_sync_server_updated_at timestamptz not null,

			unique (user_id, id)
		);`,
		`create index idx_entry_hlc on entries(user_id, _sync_hlc asc);`,
		`create index idx_server_version on entries(user_id, _sync_server_version asc);`,
		// -- entries --

		// -- users --
		`create table users (
			id text primary key not null,
			salt text not null
		);`,
		// -- users --

		// -- server_version --
		`create sequence server_version;`,

		`create or replace function update_sync_stuff()
		returns trigger as $$
		begin
			new._sync_server_version = nextval('server_version');
			new._sync_server_updated_at = now();
			return new;
		end;
		$$ LANGUAGE plpgsql;`,

		`create trigger trigger_server_version
		before insert or update on entries
		for each row execute function update_sync_stuff();`,
		// -- server_version --
	];

	const versionRows = await pg`select current from version limit 1`;
	const currentVersion = versionRows.length ? versionRows[0].current : 0;

	if (currentVersion >= migrations.length) {
		console.log("no need to migrate");
		return;
	}

	await pg.begin(async (txPg) => {
		for (let i = currentVersion; i < migrations.length; i++) {
			await txPg.unsafe(migrations[i]);
		}

		if (currentVersion === 0) {
			await txPg`insert into version (current) values (${migrations.length})`;
		} else {
			await txPg`update version set current = ${migrations.length}`;
		}
	});

	console.log(`migrated from ${currentVersion} to ${migrations.length}`);
}

main();

function decodeBase64(value) {
	if (!value.trim()) {
		throw new Error("base64 payload must be non-empty");
	}
	const binary = globalThis.atob(value);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		out[i] = binary.charCodeAt(i);
	}
	return out;
}

function encodeBase64(value) {
	let binary = "";
	for (let i = 0; i < value.length; i += 1) {
		binary += String.fromCharCode(value[i]);
	}
	return globalThis.btoa(binary);
}
