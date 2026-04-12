import { ulid } from "ulid";
import { getHLCGenerator } from "./hlc";
import {
	createDekSyncPayloadCodec,
	decodeBase64,
	deriveCryptoKeyFromPassphrase,
} from "./crypt";
import { useEffect, useRef, useState } from "react";
import { useDb } from "../providers";
import { useQueryClient } from "@tanstack/react-query";

const CLIENT_ID = "client_id";
const LAST_CURSOR = "cursor";

export function getSync({ db, dek, userId }) {
	const clientId = getClientId();
	const hlc = getHLCGenerator(clientId);

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
		const newCursor = hasMore ? dirty.at(-1)?.hlc : undefined;
		return { entries: dirty, newCursor };
	}

	async function push() {
		let pushCursor;
		while (true) {
			const { entries: dirty, newCursor: newPushCursor } = await getDirty({
				cursor: pushCursor,
			});
			if (!dirty.length) {
				console.debug("Nothing to push");
				break;
			}

			const response = await fetch("/api/v1/push?user_id=" + userId, {
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

				if (record.hlc > updatesByTable[targetTable].maxHlc) {
					updatesByTable[targetTable].maxHlc = record.hlc;
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

			setCursor(newCursor);

			if (!newPushCursor) break;
			pushCursor = newPushCursor;
		}
	}

	async function pull({ lastCursor }: { lastCursor: number | null }) {
		let cursor = lastCursor;

		while (true) {
			const response = await fetch(
				"/api/v1/pull?cursor=" + cursor + ("&user_id=" + userId),
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

					await push();
					await pull({ lastCursor: getCursor() });
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
								/* _sync_hlc */ hlc.receive(e._sync_hlc),
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
								/* _sync_hlc */ hlc.receive(e._sync_hlc),
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
								/* _sync_hlc */ hlc.receive(e._sync_hlc),
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

				setCursor(highestVersion);
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

function getClientId() {
	const existingId = localStorage.getItem(CLIENT_ID);
	if (!existingId) {
		const newId = ulid();
		localStorage.setItem(CLIENT_ID, newId);
		return newId;
	}

	return existingId;
}

function getCursor() {
	return Number(localStorage.getItem(LAST_CURSOR)) || 0;
}

function setCursor(cursor: number) {
	return localStorage.setItem(LAST_CURSOR, String(cursor ?? 0));
}

function getUserId() {
	return localStorage.getItem("user_id");
}

function setUserId(userId: string) {
	return localStorage.setItem("user_id", userId);
}

export function useSync() {
	const [sync, setSync] = useState(null);
	const db = useDb();
	const qc = useQueryClient();
	const ranRef = useRef(false);

	useEffect(() => {
		(async () => {
			if (ranRef.current) return;

			ranRef.current = true;
			const storedUserId = getUserId();
			const { user_id, salt } = await fetch("/api/v1/handshake", {
				method: "POST",
				credentials: "include",
				...(storedUserId && {
					body: JSON.stringify({
						user_id: storedUserId,
					}),
				}),
			}).then((res) => res.json());
			setUserId(user_id);

			const ev = new EventSource("/api/v1/sub?user_id=" + user_id, {
				withCredentials: true,
			});
			ev.onopen = () => console.debug("subbed!");
			ev.onerror = () => console.error("error with sub!");
			ev.onmessage = async (e) => {
				console.debug("message!", e);
				const data = e?.data;
				if (data === "poke!") {
					console.debug("Got poked!");
					await sync.pull({ lastCursor: getCursor() });
					qc.invalidateQueries();
				}
			};

			const dek = await deriveCryptoKeyFromPassphrase(
				"secret1234",
				decodeBase64(salt),
			);
			const sync = getSync({
				db,
				dek,
				userId: user_id,
			});
			setSync(sync);
			const changes = await sync.pull({ lastCursor: getCursor() || 0 });
			if (changes) {
				qc.invalidateQueries();
			}
			await sync.push();
		})();
	}, []);

	return sync;
}
