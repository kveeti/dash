import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite-async.mjs";
import * as SQLite from "wa-sqlite";
import { OPFSCoopSyncVFS } from "wa-sqlite/src/examples/OPFSCoopSyncVFS.js";
import { OPFSWriteAheadVFS } from "wa-sqlite/src/examples/OPFSWriteAheadVFS.js";

type VfsChoice = "writeahead" | "coopsync";
type BindCollection = any[] | Record<string, any> | undefined;

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

let moduleRef: any = null;
let sqlite3: any = null;
let db: number | null = null;
let vfs: any = null;
let initPromise: Promise<{ selectedVfs: VfsChoice; sqliteVersion: string }> | null = null;

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

async function detectReadwriteUnsafeSupport(): Promise<boolean> {
	let root: FileSystemDirectoryHandle | null = null;
	let dir: FileSystemDirectoryHandle | null = null;
	let filename: string | null = null;
	let handle: FileSystemSyncAccessHandle | null = null;

	try {
		root = await navigator.storage.getDirectory();
		dir = await root.getDirectoryHandle(".dash-vfs-probe", { create: true });
		filename = `rw-unsafe-${Math.random().toString(16).slice(2)}`;
		const file = await dir.getFileHandle(filename, { create: true });
		handle = await file.createSyncAccessHandle({
			mode: "readwrite-unsafe",
		} as any);
		return true;
	} catch {
		return false;
	} finally {
		if (handle) {
			handle.close();
		}
		if (dir && filename) {
			await dir.removeEntry(filename).catch(() => undefined);
		}
		if (root) {
			await root.removeEntry(".dash-vfs-probe", { recursive: true }).catch(() => undefined);
		}
	}
}

async function createVfs(
	choice: VfsChoice,
	name: string,
): Promise<{ choice: VfsChoice; instance: any }> {
	if (choice === "writeahead") {
		try {
			const instance = await OPFSWriteAheadVFS.create(name, moduleRef);
			return { choice, instance };
		} catch (error) {
			console.warn(
				"OPFSWriteAheadVFS unavailable, falling back to OPFSCoopSyncVFS:",
				toErrorMessage(error),
			);
		}
	}

	const instance = await OPFSCoopSyncVFS.create(name, moduleRef);
	return { choice: "coopsync", instance };
}

async function initialize({
	dbFile,
	preferredVfs,
}: {
	dbFile: string;
	preferredVfs: VfsChoice | null;
}): Promise<{ selectedVfs: VfsChoice; sqliteVersion: string }> {
	if (sqlite3 && db !== null) {
		return {
			selectedVfs: preferredVfs ?? "coopsync",
			sqliteVersion: sqlite3.libversion(),
		};
	}

	moduleRef = await SQLiteESMFactory();
	sqlite3 = SQLite.Factory(moduleRef);

	const shouldTryWriteAhead =
		preferredVfs === "writeahead"
			? true
			: preferredVfs === "coopsync"
				? false
				: await detectReadwriteUnsafeSupport();

	const { choice, instance } = await createVfs(
		shouldTryWriteAhead ? "writeahead" : "coopsync",
		"dash",
	);
	vfs = instance;
	sqlite3.vfs_register(vfs, true);
	db = await sqlite3.open_v2(dbFile);

	return {
		selectedVfs: choice,
		sqliteVersion: sqlite3.libversion(),
	};
}

function requireDb(): number {
	if (!sqlite3 || db === null) {
		throw new Error("sqlite worker is not initialized");
	}
	return db;
}

async function execSql(sql: string, bind?: BindCollection): Promise<void> {
	const dbHandle = requireDb();
	for await (const stmt of sqlite3.statements(dbHandle, sql)) {
		if (bind !== undefined) {
			sqlite3.bind_collection(stmt, bind);
		}
		while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
			// drain rows for statements that return data
		}
	}
}

async function querySql(
	sql: string,
	bind?: BindCollection,
): Promise<Array<Record<string, unknown>>> {
	const dbHandle = requireDb();
	const rows: Array<Record<string, unknown>> = [];

	for await (const stmt of sqlite3.statements(dbHandle, sql)) {
		if (bind !== undefined) {
			sqlite3.bind_collection(stmt, bind);
		}
		const columns = sqlite3.column_names(stmt) as string[];
		while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
			const values = sqlite3.row(stmt) as unknown[];
			const row: Record<string, unknown> = {};
			for (let i = 0; i < columns.length; i++) {
				row[columns[i]] = values[i];
			}
			rows.push(row);
		}
	}

	return rows;
}

async function closeDb(): Promise<void> {
	if (sqlite3 && db !== null) {
		await sqlite3.close(db);
		db = null;
	}
	if (vfs && typeof vfs.close === "function") {
		await vfs.close();
	}
	vfs = null;
	sqlite3 = null;
	moduleRef = null;
	initPromise = null;
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
	void (async () => {
		const message = event.data;
		try {
			switch (message.type) {
				case "init": {
					if (!initPromise) {
						initPromise = initialize({
							dbFile: message.dbFile,
							preferredVfs: message.preferredVfs,
						});
					}
					const result = await initPromise;
					postMessage({ id: message.id, ok: true, result });
					break;
				}
				case "exec": {
					await execSql(message.sql, message.bind);
					postMessage({ id: message.id, ok: true, result: null });
					break;
				}
				case "query": {
					const result = await querySql(message.sql, message.bind);
					postMessage({ id: message.id, ok: true, result });
					break;
				}
				case "close": {
					await closeDb();
					postMessage({ id: message.id, ok: true, result: null });
					break;
				}
			}
		} catch (error) {
			if (message.type === "init") {
				initPromise = null;
			}
			postMessage({
				id: message.id,
				ok: false,
				error: toErrorMessage(error),
			});
		}
	})();
});
