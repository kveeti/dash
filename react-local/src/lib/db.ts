import {
	sqlite3Worker1Promiser,
	type Worker1Promiser,
} from "@sqlite.org/sqlite-wasm";
function makeExec(promiser: Worker1Promiser) {
	return async function exec(sql: string, vars?: any[]): Promise<any> {
		const result = await promiser("exec", { sql, bind: vars });
		return result.result;
	};
}

function makeQuery(promiser: Worker1Promiser) {
	return async function query(sql: string, vars?: any[]): Promise<any[]> {
		const rows: any[] = [];
		await promiser("exec", {
			sql,
			bind: vars,
			rowMode: "object",
			callback: (msg) => {
				if (msg.rowNumber !== null) {
					rows.push(msg.row);
				}
			},
		});
		return rows;
	};
}

export type DbHandle = {
	exec: (sql: string, vars?: any[]) => Promise<any>;
	query: <T = any>(sql: string, vars?: any[]) => Promise<T[]>;
	withTx: <T>(fn: () => Promise<T>) => Promise<T>;
};

export function sqlite(
	migrations: (db: DbHandle) => Promise<void>,
) {
	let ready = false;
	let handle: DbHandle;

	const initPromise = (async () => {
		console.log("sqlite initializing...");

		const promiser = await new Promise<Worker1Promiser>((resolve) => {
			sqlite3Worker1Promiser({ onready: resolve });
		});

		const configResponse = await promiser("config-get", {});
		console.log("sqlite version", configResponse.result.version.libVersion);

		const openResponse = await promiser("open", {
			filename: "file:db2?vfs=opfs",
		});
		console.log(
			"sqlite db created at",
			openResponse.result.filename.replace(/^file:(.*?)\?vfs=opfs$/, "$1"),
		);

		const exec = makeExec(promiser);
		const query = makeQuery(promiser);
		let txDepth = 0;
		handle = {
			exec,
			query,
			withTx: async <T>(fn: () => Promise<T>): Promise<T> => {
				const isOuter = txDepth === 0;
				txDepth++;
				if (isOuter) await exec("BEGIN");
				try {
					const result = await fn();
					txDepth--;
					if (isOuter) await exec("COMMIT");
					return result;
				} catch (error) {
					txDepth--;
					if (isOuter) await exec("ROLLBACK");
					throw error;
				}
			},
		};

		await migrations(handle);

		ready = true;
		console.log("sqlite initialized");
	})();

	return {
		query: async <T = any>(sql: string, vars?: any[]): Promise<T[]> => {
			if (!ready) await initPromise;
			return await handle.query<T>(sql, vars);
		},
		exec: async (sql: string, vars?: any[]) => {
			if (!ready) await initPromise;
			return await handle.exec(sql, vars);
		},
		withTx: async <T>(fn: () => Promise<T>): Promise<T> => {
			if (!ready) await initPromise;
			return await handle.withTx(fn);
		},
	};
}

export function getDb() {
	return sqlite(async ({ exec, query }) => {
		await exec(`create table if not exists version (current integer not null)`);

		// _sync_status
		// 0 = synced
		// 1 = pending push

		const migrations = [
			`create table if not exists categories (
				id text primary key not null,
				created_at text not null,
				updated_at text,
				name text not null unique,
				is_neutral integer not null default 0,

				_sync_edited_at integer not null default 0,
				_sync_is_deleted integer default 0,
				_sync_status integer default 1
			)`,
			`create table if not exists accounts (
				id text primary key not null,
				name text not null unique,
				created_at text not null,
				updated_at text,

				_sync_edited_at integer not null default 0,
				_sync_is_deleted integer default 0,
				_sync_status integer default 1
			)`,
			`create table if not exists transactions (
				id text primary key not null,
				created_at text not null,
				updated_at text,
				date text not null,
				amount integer not null,
				currency text not null default 'EUR',
				counter_party text not null,
				additional text,
				notes text,
				categorize_on text,
				category_id text,
				account_id text not null,

				_sync_edited_at integer not null default 0,
				_sync_is_deleted integer default 0,
				_sync_status integer default 1
			)`,
			`create index if not exists idx_tx_date on transactions(date desc, id desc)`,
			`create index if not exists idx_tx_category on transactions(category_id)`,
			`create index if not exists idx_tx_account on transactions(account_id)`,
			`create table if not exists transaction_links (
				transaction_a_id text not null,
				transaction_b_id text not null,
				created_at text not null,
				updated_at text,

				_sync_edited_at integer not null default 0,
				_sync_is_deleted integer default 0,
				_sync_status integer default 1,

				primary key (transaction_a_id, transaction_b_id)
			)`,
		];

		const versionRows = await query<{ current: number }>(
			"select current from version limit 1",
		);
		const currentVersion = versionRows.length ? versionRows[0].current : 0;

		if (currentVersion >= migrations.length) return;

		for (let i = currentVersion; i < migrations.length; i++) {
			await exec(migrations[i]);
		}

		if (currentVersion === 0) {
			await exec("insert into version (current) values (?)", [
				migrations.length,
			]);
		} else {
			await exec("update version set current = ?", [migrations.length]);
		}
	});
}
