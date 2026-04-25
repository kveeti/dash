export type DbHandle = {
	exec: (sql: string, vars?: any[]) => Promise<any>;
	query: <T = any>(sql: string, vars?: any[]) => Promise<T[]>;
	withTx: <T>(fn: () => Promise<T>) => Promise<T>;
};

export type DbClient = DbHandle & {
	close: () => Promise<void>;
};

const SQLITE_DB_FILE = "db4";
const SQLITE_OPFS_DB_BASENAMES = [SQLITE_DB_FILE, "db3", "db2", "db"] as const;
const SQLITE_PASSWORD_PROMPT =
	"Enter your local database password.\nThis is required every time you open the app.";
const SQLITE_KDF_ITERATIONS = 400_000;
const SQLITE_KDF_HASH: HmacImportParams["hash"] = "SHA-256";
const SQLITE_KDF_KEY_BYTES = 32;
const SQLITE_KDF_SALT = new TextEncoder().encode("dash-local-db-kdf-v1");

function createSqliteWorker(): Worker {
	return new Worker(new URL("./sqlite-worker.js", import.meta.url), {
		type: "module",
	});
}

type SqliteWorkerMethod = "init" | "exec" | "query" | "close";

type SqliteWorkerRequestPayloadMap = {
	init: { keyHex: string; dbFile: string };
	exec: { sql: string; vars?: any[] };
	query: { sql: string; vars?: any[] };
	close: undefined;
};

type SqliteWorkerResponsePayloadMap = {
	init: { libVersion: string; filename: string };
	exec: null;
	query: any[];
	close: null;
};

type SqliteWorkerRequest<M extends SqliteWorkerMethod = SqliteWorkerMethod> = {
	id: number;
	method: M;
	payload: SqliteWorkerRequestPayloadMap[M];
};

type SqliteWorkerErrorPayload = {
	name: string;
	message: string;
	stack?: string;
};

type SqliteWorkerSuccessResponse<M extends SqliteWorkerMethod = SqliteWorkerMethod> = {
	id: number;
	ok: true;
	payload: SqliteWorkerResponsePayloadMap[M];
};

type SqliteWorkerErrorResponse = {
	id: number;
	ok: false;
	error: SqliteWorkerErrorPayload;
};

type SqliteWorkerResponse =
	| SqliteWorkerSuccessResponse
	| SqliteWorkerErrorResponse;

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function deriveSqliteKeyHexFromPassword(password: string): Promise<string> {
	if (!globalThis.crypto?.subtle) {
		throw new Error("WebCrypto subtle API is unavailable; cannot derive database key");
	}
	const baseKey = await globalThis.crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		{ name: "PBKDF2" },
		false,
		["deriveBits"],
	);
	const derived = await globalThis.crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt: SQLITE_KDF_SALT,
			iterations: SQLITE_KDF_ITERATIONS,
			hash: SQLITE_KDF_HASH,
		},
		baseKey,
		SQLITE_KDF_KEY_BYTES * 8,
	);
	return toHex(new Uint8Array(derived));
}

async function promptForSqliteKeyHex(): Promise<string> {
	if (typeof window === "undefined" || typeof window.prompt !== "function") {
		throw new Error("No browser prompt available for database password entry");
	}
	const password = window.prompt(SQLITE_PASSWORD_PROMPT);
	if (!password) {
		throw new Error("Database password is required");
	}
	return await deriveSqliteKeyHexFromPassword(password);
}

function isSqliteDbRelatedFile(name: string) {
	return SQLITE_OPFS_DB_BASENAMES.some(
		(base) => name === base || name.startsWith(`${base}-`),
	);
}

export async function deleteSqliteOpfsFiles(): Promise<string[]> {
	const root = await navigator.storage.getDirectory();
	const removed: string[] = [];

	for await (const [name, handle] of root.entries()) {
		if (handle.kind !== "file") continue;
		if (!isSqliteDbRelatedFile(name)) continue;
		await root.removeEntry(name);
		removed.push(name);
	}

	removed.sort();
	return removed;
}

export function sqlite(
	migrations: (db: DbHandle) => Promise<void>,
) {
	let ready = false;
	let handle: DbHandle;
	let workerRef: Worker | null = null;
	let closed = false;
	let nextRequestId = 1;
	const pendingRequests = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (reason: unknown) => void;
		}
	>();

	const rejectPendingRequests = (reason: unknown) => {
		for (const request of pendingRequests.values()) {
			request.reject(reason);
		}
		pendingRequests.clear();
	};

	const toWorkerError = (payload: SqliteWorkerErrorPayload) => {
		const error = new Error(payload.message);
		error.name = payload.name;
		if (payload.stack) error.stack = payload.stack;
		return error;
	};

	const ensureWorker = () => {
		if (workerRef) return workerRef;
		const worker = createSqliteWorker();
		worker.onmessage = (event: MessageEvent<SqliteWorkerResponse>) => {
			const message = event.data;
			const pending = pendingRequests.get(message.id);
			if (!pending) return;
			pendingRequests.delete(message.id);
			if (message.ok) {
				pending.resolve(message.payload);
				return;
			}
			pending.reject(toWorkerError(message.error));
		};
		worker.onerror = (event) => {
			rejectPendingRequests(
				new Error(event.message || "sqlite worker crashed"),
			);
		};
		workerRef = worker;
		return worker;
	};

	const callWorker = async <M extends SqliteWorkerMethod>(
		method: M,
		payload: SqliteWorkerRequestPayloadMap[M],
	): Promise<SqliteWorkerResponsePayloadMap[M]> => {
		const worker = ensureWorker();
		const id = nextRequestId++;
		return await new Promise<SqliteWorkerResponsePayloadMap[M]>((resolve, reject) => {
			pendingRequests.set(id, {
				resolve: (value) => resolve(value as SqliteWorkerResponsePayloadMap[M]),
				reject,
			});
			const request: SqliteWorkerRequest<M> = { id, method, payload };
			worker.postMessage(request);
		});
	};

	const initPromise = (async () => {
		console.log("sqlite initializing...");

		const keyHex = await promptForSqliteKeyHex();
		const initResponse = await callWorker("init", {
			keyHex,
			dbFile: SQLITE_DB_FILE,
		});
		console.log("sqlite version", initResponse.libVersion);
		console.log(
			"sqlite db opened at",
			initResponse.filename,
		);

		const exec = async (sql: string, vars?: any[]) =>
			await callWorker("exec", { sql, vars });
		const query = async <T = any>(sql: string, vars?: any[]): Promise<T[]> => {
			const rows = await callWorker("query", { sql, vars });
			return rows as T[];
		};

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
		console.log("sqlite ready");
	})();

	return {
		query: async <T = any>(sql: string, vars?: any[]): Promise<T[]> => {
			if (closed) throw new Error("sqlite connection is closed");
			if (!ready) await initPromise;
			return await handle.query<T>(sql, vars);
		},
		exec: async (sql: string, vars?: any[]) => {
			if (closed) throw new Error("sqlite connection is closed");
			if (!ready) await initPromise;
			return await handle.exec(sql, vars);
		},
		withTx: async <T>(fn: () => Promise<T>): Promise<T> => {
			if (closed) throw new Error("sqlite connection is closed");
			if (!ready) await initPromise;
			return await handle.withTx(fn);
		},
			close: async () => {
				if (closed) return;
				if (ready) {
					await callWorker("close", undefined);
				}
				workerRef?.terminate();
				rejectPendingRequests(new Error("sqlite worker terminated"));
				workerRef = null;
				closed = true;
				ready = false;
			},
		} satisfies DbClient;
}

export function getDb(): DbClient {
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
				currency text not null default 'EUR',
				external_id text,
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

			`create index if not exists idx_tx_effective_date
				on transactions(coalesce(categorize_on, date) desc, id desc)
				where _sync_is_deleted = 0`,

			`create index if not exists idx_tx_currency_effective_date
				on transactions(currency, coalesce(categorize_on, date) desc)
				where _sync_is_deleted = 0`,

			`create index if not exists idx_tx_date_active
				on transactions(date desc, id desc)
				where _sync_is_deleted = 0`,

			`create index if not exists idx_tx_category_date_active
				on transactions(category_id, date desc, id desc)
				where _sync_is_deleted = 0`,

			`create index if not exists idx_tx_account_date_active
				on transactions(account_id, date desc, id desc)
				where _sync_is_deleted = 0`,

			`create index if not exists idx_tx_currency_date_active
				on transactions(currency, date desc, id desc)
				where _sync_is_deleted = 0`,

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

			`create index if not exists idx_tx_links_a_active
				on transaction_links(transaction_a_id)
				where _sync_is_deleted = 0`,

			`create index if not exists idx_tx_links_b_active
				on transaction_links(transaction_b_id)
				where _sync_is_deleted = 0`,

			`create table if not exists app_settings (
				id integer primary key not null check (id = 1),
				reporting_currency text not null default 'EUR',
				max_staleness_days integer not null default 7,
				conversion_mode text not null default 'strict',
				updated_at text not null
			)`,

			`insert into app_settings (
				id, reporting_currency, max_staleness_days, conversion_mode, updated_at
			)
			values (
				1, 'EUR', 7, 'strict', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			)
			on conflict(id) do nothing`,

			`create table if not exists fx_rates (
				rate_date text not null,
				currency text not null,
				rate_to_anchor real not null,
				primary key (currency, rate_date)
			)`,

			`create index if not exists idx_fx_rates_currency_date_desc
				on fx_rates(currency, rate_date desc)`,

			`create table if not exists transaction_import_keys (
				id text primary key not null,
				transaction_id text not null,
				source_type text not null,
				source_scope text not null,
				key_type text not null,
				key_value text not null,
				created_at text not null,
				last_seen_at text not null,
				seen_count integer not null default 1,

				_sync_edited_at integer not null default 0,
				_sync_is_deleted integer default 0,
				_sync_status integer default 1
			)`,

			`create unique index if not exists idx_tx_import_keys_unique_active
				on transaction_import_keys(source_type, source_scope, key_type, key_value)
				where _sync_is_deleted = 0`,

			`create index if not exists idx_tx_import_keys_tx_active
				on transaction_import_keys(transaction_id)
				where _sync_is_deleted = 0`,

			`create table if not exists transaction_link_dismissals (
				transaction_a_id text not null,
				transaction_b_id text not null,
				created_at text not null,
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
