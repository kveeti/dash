import { Dexie, type EntityTable } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { createDekSyncPayloadCodec } from "./crypt";
import { useQuery } from "@tanstack/react-query";
import { useMe } from "./queries/auth";
import { useDb } from "../providers";

export function getSync({ db, dek }) {
	const codec = createDekSyncPayloadCodec(dek);

	async function getDirty({ cursor }: { cursor: string | undefined }) {
		const limit = 1000;

		const dirty = await db.query(
			`
			select * from (
				-- categories
				select
					'category:' || id as id,
					_sync_hlc,
					_sync_is_deleted,
					json_object('created_at', created_at, 'updated_at', updated_at, 'name', name, 'is_neutral', is_neutral) as plain_data,
					1 as priority
				from categories where _sync_status = 1

				union all

				-- accounts
				select
					'account:' || id as id,
					_sync_hlc,
					_sync_is_deleted,
					json_object('created_at', created_at, 'updated_at', updated_at, 'name', name) as plain_data,
					1 as priority
				from accounts where _sync_status = 1

				union all

				-- transactions
				select
					'transaction:' || id as id,
					_sync_hlc,
					_sync_is_deleted,
					json_object('created_at', created_at, 'updated_at', updated_at, 'date', date, 'amount', amount, 'currency', currency, 'counter_party', counter_party, 'additional', additional, 'notes', notes, 'categorize_on', categorize_on, 'category_id', category_id, 'account_id', account_id) as plain_data,
					2 as priority
				from transactions where _sync_status = 1

				union all

				-- transaction links
				select
					'transaction_link:' || transaction_a_id || '_' || transaction_b_id as id,
					_sync_hlc,
					_sync_is_deleted,
					json_object('transaction_a_id', transaction_a_id, 'transaction_b_id', transaction_b_id, 'created_at', created_at) as plain_data,
					3 as priority
				from transaction_links where _sync_status = 1
			) 
			${cursor ? `where _sync_hlc > ?` : ``}
			order by priority asc, _sync_hlc asc
			limit ?;
		`,
			cursor ? [cursor, limit + 1] : [limit + 1],
		);
		// order by prio first to retain topology, parents first

		if (!dirty.length) {
			return { entries: [], newCursor: undefined };
		}

		const hasMore = dirty.length === limit + 1;
		if (hasMore) {
			dirty.pop();
		}
		const newCursor = hasMore ? dirty.at(-1)?._sync_hlc : undefined;
		return { entries: dirty, newCursor };
	}

	async function push({
		setCursor,
	}: {
		setCursor: (newCursor: number) => Promise<void>;
	}) {
		let newCursorReturn;
		let pushCursor;
		while (true) {
			const { entries: dirty, newCursor: newPushCursor } = await getDirty({
				cursor: pushCursor,
			});
			if (!dirty.length) {
				console.debug("Nothing to push");
				break;
			}

			const response = await fetch("/api/v1/push", {
				body: JSON.stringify(
					await Promise.all(
						dirty.map(async (d) => {
							const encrypted_data = await codec.encodeJsonString(d.plain_data);
							return {
								id: d.id,
								blob: encrypted_data,

								_sync_hlc: d._sync_hlc,
								_sync_is_deleted: d._sync_is_deleted,
							};
						}),
					),
				),
				method: "POST",
				credentials: "include",
			});
			if (!response.ok) {
				throw new Error("Server did not accept push");
			}

			const { new_cursor: newCursor } = await response.json();

			const updatesByTable = {
				categories: { ids: [], maxHlc: "" },
				accounts: { ids: [], maxHlc: "" },
				transactions: { ids: [], maxHlc: "" },
				transaction_links: { ids: [], maxHlc: "" },
			};

			for (const record of dirty) {
				const [tableNameRaw, actualId] = record.id.split(":");
				const targetTable =
					tableNameRaw === "category" ? "categories" : tableNameRaw + "s";

				updatesByTable[targetTable].ids.push(actualId);

				if (record._sync_hlc > updatesByTable[targetTable].maxHlc) {
					updatesByTable[targetTable].maxHlc = record._sync_hlc;
				}
			}

			for (const [tableName, data] of Object.entries(updatesByTable)) {
				if (data.ids.length === 0) continue; // Skip tables that had no updates in this batch

				const placeholders = data.ids.map(() => "?").join(",");

				if (tableName === "transaction_links") {
					await db.exec(
						`update transaction_links
						set _sync_status = 0
						where transaction_a_id || '_' || transaction_b_id IN (${placeholders}) 
						and _sync_hlc <= ?`,
						[...data.ids, data.maxHlc],
					);
				} else {
					await db.exec(
						`update ${tableName}
						set _sync_status = 0
						where id in (${placeholders}) 
						and _sync_hlc <= ?`,
						[...data.ids, data.maxHlc],
					);
				}
			}

			await setCursor(newCursor);
			newCursorReturn = newCursor;

			pushCursor = newPushCursor;
			if (!newPushCursor) break;
		}

		return newCursorReturn;
	}

	async function pull({
		lastCursor,
		setCursor,
	}: {
		lastCursor: number | null;
		setCursor(newCursor: number): Promise<void>;
	}) {
		let cursor = lastCursor;

		while (true) {
			const response = await fetch(
				"/api/v1/pull?" + (cursor ? "cursor=" + cursor : ""),
				{
					method: "GET",
					credentials: "include",
				},
			);

			if (!response.ok && response.status === 409) {
				const json = await response.json();
				if (json.error === "cursor_gt_max") {
					await Promise.all([
						db.exec(`update categories set _sync_status = 1`),
						db.exec(`update accounts set _sync_status = 1`),
						db.exec(`update transactions set _sync_status = 1`),
						db.exec(`update transaction_links set _sync_status = 1`),
					]);

					const newestCursor = await push({ setCursor });
					await pull({ lastCursor: newestCursor, setCursor });
					break;
				}
			}

			const {
				entries,
				next_cursor: nextCursor,
				highest_version: highestVersion,
			} = await response.json();
			if (!entries.length) return false;

			const accounts = [];
			const accountsValues = [];

			const categories = [];
			const categoriesValues = [];

			const transactions = [];
			const transactionsValues = [];

			await Promise.all(
				entries.map(async (e) => {
					const entry = await codec.decode(e.blob);

					const [type, id] = e.id.split(":");
					switch (type) {
						case "account":
							accounts.push(
								/* id */ id,
								/* created_at */ entry.created_at,
								/* updated_at */ entry.updated_at,
								/* name */ entry.name,

								/* _sync_is_deleted */ e._sync_is_deleted,
								/* _sync_hlc */ db.hlc.receive(e._sync_hlc),
							);
							accountsValues.push("(?, ?, ?, ?, ?, ?, 0)");
							break;

						case "category":
							categories.push(
								/* id */ id,
								/* created_at */ entry.created_at,
								/* updated_at */ entry.updated_at,
								/* name */ entry.name,
								/* is_neutral */ entry.is_neutral,

								/* _sync_is_deleted */ e._sync_is_deleted,
								/* _sync_hlc */ db.hlc.receive(e._sync_hlc),
							);
							categoriesValues.push("(?, ?, ?, ?, ?, ?, ?, 0)");
							break;

						case "transaction":
							transactions.push(
								/* id */ id,
								/* created_at */ entry.created_at,
								/* updated_at */ entry.updated_at,
								/* date */ entry.date,
								/* amount */ entry.amount,
								/* currency */ entry.currency,
								/* counter_party */ entry.counter_party,
								/* additional */ entry.additional,
								/* notes */ entry.notes,
								/* categorize_on */ entry.categorize_on,
								/* category_id */ entry.category_id,
								/* account_id */ entry.account_id,

								/* _sync_is_deleted */ e._sync_is_deleted,
								/* _sync_hlc */ db.hlc.receive(e._sync_hlc),
							);
							transactionsValues.push(
								"(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
							);
							break;
					}
				}),
			);

			try {
				if (accounts.length) {
					await db.exec(
						`insert into accounts (
							id,
							created_at,
							updated_at,
							name,

							_sync_is_deleted,
							_sync_hlc,
							_sync_status
						)
						values ${accountsValues.join(",")}
						on conflict(id) do update set
							_sync_hlc = excluded._sync_hlc,
							_sync_is_deleted = excluded._sync_is_deleted,
							_sync_status = 0,

							name = excluded.name
						where excluded.hlc > accounts.hlc;`,
						accounts,
					);
				}

				if (categories.length) {
					await db.exec(
						`insert into categories (
							id,
							created_at,
							updated_at,
							name,
							is_neutral,

							_sync_is_deleted,
							_sync_hlc,
							_sync_status
						)
						values
						${categoriesValues.join(",")}
						on conflict(id) do update set
							_sync_hlc = excluded._sync_hlc,
							_sync_is_deleted = excluded._sync_is_deleted,
							_sync_status = 0,

							name = excluded.name,
							is_neutral = excluded.is_neutral
						where excluded._sync_hlc > categories._sync_hlc;`,
						categories,
					);
				}

				if (transactions.length) {
					await db.exec(
						`insert into transactions (
							id,
							created_at,
							updated_at,
							date,
							amount,
							currency,
							counter_party,
							additional,
							notes,
							categorize_on,
							category_id,
							account_id,

							_sync_is_deleted,
							_sync_hlc,
							_sync_status
						)
						values
						${transactionsValues.join(",")}
						on conflict(id) do update set
							_sync_hlc = excluded._sync_hlc,
							_sync_is_deleted = excluded._sync_is_deleted,
							_sync_status = 0,

							date = excluded.date,
							amount = excluded.amount,
							currency = excluded.currency,
							counter_party = excluded.counter_party,
							additional = excluded.additional,
							notes = excluded.notes,
							categorize_on = excluded.categorize_on,
							category_id = excluded.category_id,
							account_id = excluded.account_id
						where excluded._sync_hlc > transactions._sync_hlc;`,
						transactions,
					);
				}

				await setCursor(highestVersion);
			} catch (e) {
				console.error(e);
			}

			if (!nextCursor) break;
			cursor = nextCursor;
		}

		return true;
	}

	return {
		push,
		pull,
	};
}

export type UiStorage = {
	id: string;
	dek: CryptoKey | null;
	cursor: number | null;
	sync_state: "enabled" | "paused" | null;
};

export const idb = new Dexie("money") as Dexie & {
	uiStorage: EntityTable<UiStorage, "id">;
};
idb.version(1).stores({
	uiStorage: "id, dek, cursor, sync_state",
});

export const uiStorageDefaults = {
	id: "1",
	dek: null,
	cursor: null,
	sync_state: null,
};

async function setCursor(prev: UiStorage | undefined, newCursor: number) {
	await idb.uiStorage.put({
		...(prev ?? uiStorageDefaults),
		cursor: newCursor,
	});
}

export function useSync() {
	const uiStorage = useLiveQuery(async () => {
		return await idb.uiStorage.where("id").equals(uiStorageDefaults.id).first();
	});

	const canSync = uiStorage?.sync_state === "enabled" && !!uiStorage?.dek;
	const me = useMe();

	const db = useDb();

	const pull = useQuery({
		enabled: canSync && !!me?.data?.salt,
		queryKey: ["pull", canSync, me?.data?.salt],
		queryFn: async () => {
			const dek = uiStorage!.dek!;
			const cursor = uiStorage!.cursor;
			const sync = getSync({ db, dek });
			await sync.pull({
				lastCursor: cursor,
				setCursor: async (newCursor) => {
					await setCursor(uiStorage, newCursor);
				},
			});
			return true;
		},
	});

	useQuery({
		enabled: !!pull.data,
		queryKey: ["push", pull.data],
		queryFn: async () => {
			const dek = uiStorage!.dek!;
			const sync = getSync({ db, dek });
			await sync.push({
				setCursor: async (newCursor) => {
					await setCursor(uiStorage, newCursor);
				},
			});
			return true;
		},
	});

	return null;
}
