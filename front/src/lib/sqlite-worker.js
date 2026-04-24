import sqlite3InitModule from "./sqlite-custom/sqlite3.mjs";

let sqlite3ModulePromise = null;
let sqlite3Module = null;
let db = null;
const VFS = "multipleciphers-opfs";
const OPFS_BUSY_TIMEOUT_MS = 10_000;

function serializeError(error) {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}
	return {
		name: "Error",
		message: String(error),
	};
}

async function getSqliteModule() {
	if (!sqlite3ModulePromise) {
		sqlite3ModulePromise = sqlite3InitModule();
	}
	if (!sqlite3Module) {
		sqlite3Module = await sqlite3ModulePromise;
	}
	return sqlite3Module;
}

function ensureInitializedDb() {
	if (!db) {
		throw new Error("sqlite database is not initialized");
	}
	return db;
}

function openDatabase(sqlite3, dbFile) {
	return new sqlite3.oo1.DB({
		filename: dbFile,
		flags: "c",
		vfs: VFS,
	});
}

async function handleInit(payload) {
	if (db) {
		return {
			libVersion: sqlite3Module.version.libVersion,
			filename: db.filename,
		};
	}

	const sqlite3 = await getSqliteModule();
	const { keyHex, dbFile } = payload;

	db = openDatabase(sqlite3, dbFile);
	db.exec(`pragma cipher='chacha20'`);
	db.exec(`pragma key="x'${keyHex}'"`);
	db.exec(`pragma busy_timeout=${OPFS_BUSY_TIMEOUT_MS}`);
	db.exec("select count(*) as c from sqlite_master");

	return {
		libVersion: sqlite3.version.libVersion,
		filename: db.filename,
	};
}

function handleExec(payload) {
	const targetDb = ensureInitializedDb();
	const { sql, vars } = payload;
	if (vars === undefined) {
		targetDb.exec(sql);
	} else {
		targetDb.exec({ sql, bind: vars });
	}
	return null;
}

function handleQuery(payload) {
	const targetDb = ensureInitializedDb();
	const { sql, vars } = payload;
	const rows = [];
	if (vars === undefined) {
		targetDb.exec({
			sql,
			rowMode: "object",
			resultRows: rows,
			returnValue: "resultRows",
		});
	} else {
		targetDb.exec({
			sql,
			bind: vars,
			rowMode: "object",
			resultRows: rows,
			returnValue: "resultRows",
		});
	}
	return rows;
}

function handleClose() {
	if (db) {
		db.close();
		db = null;
	}
	return null;
}

globalThis.onmessage = async (event) => {
	const message = event.data;
	const { id, method, payload } = message;
	try {
		let responsePayload;
		switch (method) {
			case "init":
				responsePayload = await handleInit(payload);
				break;
			case "exec":
				responsePayload = handleExec(payload);
				break;
			case "query":
				responsePayload = handleQuery(payload);
				break;
			case "close":
				responsePayload = handleClose();
				break;
			default:
				throw new Error(`unsupported sqlite worker method: ${String(method)}`);
		}
		globalThis.postMessage({
			id,
			ok: true,
			payload: responsePayload,
		});
	} catch (error) {
		globalThis.postMessage({
			id,
			ok: false,
			error: serializeError(error),
		});
	}
};
