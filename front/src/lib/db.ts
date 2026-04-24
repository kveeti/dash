type VfsChoice = "writeahead" | "coopsync";
type BindCollection = any[] | Record<string, any> | undefined;

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
const WA_SQLITE_LIBRARY_DIR = ".wa-sqlite";
const VFS_CHOICE_STORAGE_KEY = "dash.sqlite.vfs";

function readStoredVfsChoice(): VfsChoice | null {
	try {
		const raw = localStorage.getItem(VFS_CHOICE_STORAGE_KEY);
		if (raw === "writeahead" || raw === "coopsync") return raw;
		return null;
	} catch {
		return null;
	}
}

function writeStoredVfsChoice(choice: VfsChoice) {
	try {
		localStorage.setItem(VFS_CHOICE_STORAGE_KEY, choice);
	} catch {
		// Ignore storage failures (e.g. private mode restrictions).
	}
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
		if (handle.kind === "file") {
			if (!isSqliteDbRelatedFile(name)) continue;
			await root.removeEntry(name);
			removed.push(name);
			continue;
		}
		if (handle.kind === "directory" && name === WA_SQLITE_LIBRARY_DIR) {
			await root.removeEntry(name, { recursive: true });
			removed.push(`${name}/`);
		}
	}

	removed.sort();
	return removed;
}

type WorkerRequest =
	| {
			id: number;
			type: "init";
			dbFile: string;
			preferredVfs: VfsChoice | null;
	  }
	| {
			id: number;
			type: "exec";
			sql: string;
			bind?: BindCollection;
	  }
	| {
			id: number;
			type: "query";
			sql: string;
			bind?: BindCollection;
	  }
	| {
			id: number;
			type: "close";
	  };

type WorkerSuccessResponse = { id: number; ok: true; result: any };
type WorkerErrorResponse = { id: number; ok: false; error: string };
type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

function createWorkerBridge() {
	const worker = new Worker(new URL("./db-worker.ts", import.meta.url), {
		type: "module",
	});
	let nextId = 1;
	const pending = new Map<
		number,
		{
			resolve: (value: any) => void;
			reject: (reason?: unknown) => void;
		}
	>();

	const rejectAll = (reason: unknown) => {
		for (const { reject } of pending.values()) reject(reason);
		pending.clear();
	};

	worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
		const message = event.data;
		if (!message || typeof message !== "object" || !("id" in message)) return;
		const record = pending.get(message.id);
		if (!record) return;
		pending.delete(message.id);
		if (message.ok) {
			record.resolve(message.result);
		} else {
			record.reject(new Error(message.error));
		}
	});

	worker.addEventListener("error", (event) => {
		const message = event.message || "Database worker crashed";
		rejectAll(new Error(message));
	});

	worker.addEventListener("messageerror", () => {
		rejectAll(new Error("Database worker message channel error"));
	});

	const request = <T>(payload: Omit<WorkerRequest, "id">): Promise<T> => {
		const id = nextId++;
		return new Promise<T>((resolve, reject) => {
			pending.set(id, { resolve, reject });
			worker.postMessage({ id, ...payload } satisfies WorkerRequest);
		});
	};

	return {
		request,
		terminate: () => {
			worker.terminate();
			rejectAll(new Error("Database worker terminated"));
		},
	};
}

function createWorkerDbClient() {
	const bridge = createWorkerBridge();
	let closed = false;

	const initPromise = (async () => {
		const preferredVfs = readStoredVfsChoice();
		const result = await bridge.request<{
			selectedVfs: VfsChoice;
			sqliteVersion: string;
		}>({
			type: "init",
			dbFile: SQLITE_DB_FILE,
			preferredVfs,
		});

		if (result.selectedVfs !== preferredVfs) {
			writeStoredVfsChoice(result.selectedVfs);
		}
		console.log("sqlite version", result.sqliteVersion);
		console.log("sqlite vfs", result.selectedVfs);
	})();

	const ensureReady = async () => {
		if (closed) throw new Error("sqlite connection is closed");
		await initPromise;
	};

	return {
		exec: async (sql: string, bind?: BindCollection): Promise<any> => {
			await ensureReady();
			return bridge.request({ type: "exec", sql, bind });
		},
		query: async <T = any>(sql: string, bind?: BindCollection): Promise<T[]> => {
			await ensureReady();
			return bridge.request<T[]>({ type: "query", sql, bind });
		},
		close: async () => {
			if (closed) return;
			closed = true;
			try {
				await bridge.request({ type: "close" });
			} catch {
				// The worker may already be gone; ignore close-time failures.
			} finally {
				bridge.terminate();
			}
		},
	};
}

export function sqlite(
	migrations: (db: DbHandle) => Promise<void>,
) {
	let ready = false;
	let handle: DbHandle;
	const dbClient = createWorkerDbClient();
	let closed = false;

	const initPromise = (async () => {
		console.log("sqlite initializing...");
		const exec = dbClient.exec;
		const query = dbClient.query;
		let txDepth = 0;
		handle = {
			exec,
			query,
			withTx: async <T>(fn: () => Promise<T>): Promise<T> => {
				const isOuter = txDepth === 0;
				txDepth++;
				if (isOuter) await exec("BEGIN IMMEDIATE");
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
			try {
				if (!ready) await initPromise;
			} catch {
				// Ignore initialization failures so we can still terminate the worker.
			}
			await dbClient.close();
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
