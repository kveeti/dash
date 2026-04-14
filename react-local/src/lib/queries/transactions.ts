import {
	useQuery,
	useMutation,
	useQueryClient,
	keepPreviousData,
} from "@tanstack/react-query";
import { useDb } from "../../providers";
import { id } from "../id";
import type { DbHandle } from "../db";
import { queryKeys, queryKeyRoots, type TransactionFilters } from "./query-keys";

const DEFAULT_TRANSACTIONS_LIMIT = 50;

const TRANSACTION_WITH_RELATIONS_SELECT_SQL = `select
	t.id,
	t.date,
	t.categorize_on,
	t.amount,
	t.currency,
	t.counter_party,
	t.additional,
	t.notes,
	t.category_id,
	t.account_id,
	c.name as category_name,
	c.is_neutral as category_is_neutral,
	a.name as account_name
from transactions t
left join categories c on t.category_id = c.id
left join accounts a on t.account_id = a.id`;

type TransactionCursor = { left: string } | { right: string };
type TransactionCursorInput = {
	left: string | undefined;
	right: string | undefined;
};
type CursorDirection = "left" | "right" | null;

type TransactionInput = {
	date: string;
	amount: number;
	currency: string;
	counter_party: string;
	additional?: string;
	notes?: string;
	category_id?: string;
	account_id: string;
};

function normalizeCursor(
	cursor?: TransactionCursorInput,
): TransactionCursor | undefined {
	if (!cursor?.left && !cursor?.right) return undefined;
	if (cursor?.left) {
		return { left: cursor.left };
	}
	if (cursor?.right) {
		return { right: cursor.right };
	}
	return undefined;
}

function resolvePagination({
	rows,
	hasMore,
	direction,
}: {
	rows: TransactionRow[];
	hasMore: boolean;
	direction: CursorDirection;
}): { next_id: string | null; prev_id: string | null } {
	let next_id: string | null = null;
	let prev_id: string | null = null;

	if (rows.length >= 2) {
		const firstId = rows[0].id;
		const lastId = rows[rows.length - 1].id;

		if (hasMore && !direction) {
			next_id = lastId;
			prev_id = null;
		} else if (!hasMore && !direction) {
			next_id = null;
			prev_id = null;
		} else if (hasMore && direction) {
			next_id = lastId;
			prev_id = firstId;
		} else if (!hasMore && direction === "left") {
			next_id = lastId;
			prev_id = null;
		} else if (!hasMore && direction === "right") {
			next_id = null;
			prev_id = firstId;
		}
	}

	return { next_id, prev_id };
}

function invalidateTransactionQueries(qc: ReturnType<typeof useQueryClient>) {
	qc.invalidateQueries({ queryKey: queryKeyRoots.transactions });
	qc.invalidateQueries({ queryKey: queryKeyRoots.transaction });
}

export function useTransactionsQuery(props: {
	search: string | undefined;
	filters?: TransactionFilters;
	cursor?: TransactionCursorInput;
}) {
	const db = useDb();
	const cursor = normalizeCursor(props.cursor);

	return useQuery({
		queryKey: queryKeys.transactions(props.search, props.filters, cursor),
		queryFn: () =>
			getTransactions(db, {
				cursor,
				search: props.search,
				filters: props.filters,
				limit: DEFAULT_TRANSACTIONS_LIMIT,
			}),
		placeholderData: keepPreviousData,
	});
}

async function getTransactions(
	db: DbHandle,
	opts?: {
		search?: string;
		filters?: TransactionFilters;
		limit?: number;
		cursor?: TransactionCursor;
	},
): Promise<TransactionsResult> {
	const limit = opts?.limit ?? DEFAULT_TRANSACTIONS_LIMIT;

	let sql = TRANSACTION_WITH_RELATIONS_SELECT_SQL;

	const params: Array<string | number> = [];
	const wheres: string[] = ["t._sync_is_deleted is 0"];

	if (opts?.search) {
		wheres.push("(t.counter_party like ? or t.additional like ?)");
		params.push(`%${opts.search}%`, `%${opts.search}%`);
	}

	if (opts?.filters?.category_id) {
		wheres.push("t.category_id = ?");
		params.push(opts.filters.category_id);
	}

	if (opts?.filters?.account_id) {
		wheres.push("t.account_id = ?");
		params.push(opts.filters.account_id);
	}

	if (opts?.filters?.uncategorized) {
		wheres.push("t.category_id is null");
	}

	let direction: CursorDirection = null;
	if (opts?.cursor) {
		if ("left" in opts.cursor) {
			direction = "left";
			const cursorId = opts.cursor.left;
			wheres.push(
				"(t.date > (select date from transactions where id = ?) or (t.date = (select date from transactions where id = ?) and t.id > ?))",
			);
			params.push(cursorId, cursorId, cursorId);
		} else {
			direction = "right";
			const cursorId = opts.cursor.right;
			wheres.push(
				"(t.date < (select date from transactions where id = ?) or (t.date = (select date from transactions where id = ?) and t.id < ?))",
			);
			params.push(cursorId, cursorId, cursorId);
		}
	}

	sql += " where " + wheres.join(" and ");

	const order = direction === "left" ? "asc" : "desc";
	sql += ` order by t.date ${order}, t.id ${order} limit ?`;
	params.push(limit + 1);

	const rows = await db.query<TransactionRow>(sql, params);

	const hasMore = rows.length === limit + 1;
	if (hasMore) rows.pop();
	if (direction === "left") rows.reverse();

	const { next_id, prev_id } = resolvePagination({
		rows,
		hasMore,
		direction,
	});

	return { transactions: rows, next_id, prev_id };
}

async function getTransactionById(
	db: DbHandle,
	id: string,
): Promise<TransactionRow | null> {
	const rows = await db.query<TransactionRow>(
		`select
			t.id,
			t.date,
			t.categorize_on,
			t.amount,
			t.currency,
			t.counter_party,
			t.additional,
			t.notes,
			t.category_id,
			t.account_id,
			c.name as category_name,
			c.is_neutral as category_is_neutral,
			a.name as account_name
		from transactions t
		left join categories c on t.category_id = c.id
		left join accounts a on t.account_id = a.id
		where t.id = ? and t._sync_is_deleted = 0`,
		[id],
	);
	return rows[0] ?? null;
}

export function useTransactionQuery(id: string | undefined) {
	const db = useDb();
	return useQuery({
		queryKey: queryKeys.transaction(id),
		queryFn: () => getTransactionById(db, id!),
		enabled: !!id,
	});
}

export type TransactionsResult = {
	transactions: TransactionRow[];
	next_id: string | null;
	prev_id: string | null;
};

export type Transaction = {
	id: string;
	date: string;
	categorize_on: string | null;
	amount: number;
	currency: string;
	counter_party: string;
	additional: string | null;
	notes: string | null;
	category_id: string | null;
	account_id: string;
};

export type TransactionRow = Transaction & {
	category_name: string | null;
	category_is_neutral: number | null;
	account_name: string;
};

export function useCreateTransactionMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (tx: TransactionInput) => {
			const now = new Date().toISOString();
			await db.exec(
				`insert into transactions
				 (id, created_at, updated_at, date, amount, currency, counter_party, additional, notes, category_id, account_id, _sync_hlc)
				 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					id(),
					now,
					now,
					tx.date,
					tx.amount,
					tx.currency,
					tx.counter_party,
					tx.additional ?? null,
					tx.notes ?? null,
					tx.category_id ?? null,
					tx.account_id,
					db.hlc.generate(),
				],
			);
		},
		onSuccess: () => invalidateTransactionQueries(qc),
	});
}

export function useUpdateTransactionMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			txId,
			tx,
		}: {
			txId: string;
			tx: TransactionInput;
		}) => {
			const now = new Date().toISOString();
			return db.exec(
				`update transactions set
					updated_at = ?,
					date = ?,
					amount = ?,
					currency = ?,
					counter_party = ?,
					additional = ?,
					notes = ?,
					category_id = ?,
					account_id = ?,
					_sync_hlc = ?,
					_sync_status = 1
 				where id = ?`,
				[
					now,
					tx.date,
					tx.amount,
					tx.currency,
					tx.counter_party,
					tx.additional ?? null,
					tx.notes ?? null,
					tx.category_id ?? null,
					tx.account_id,
					db.hlc.generate(),
					txId,
				],
			);
		},
		onSuccess: () => invalidateTransactionQueries(qc),
	});
}

export function useBulkSetCategoryMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async ({
			txIds,
			categoryId,
		}: {
			txIds: string[];
			categoryId: string | null;
		}) => {
			await db.withTx(async () => {
				const now = new Date().toISOString();
				for (const txId of txIds) {
					await db.exec(
						`update transactions set
							category_id = ?,
							updated_at = ?,
							_sync_hlc = ?,
							_sync_status = 1
						where id = ?`,
						[categoryId, now, db.hlc.generate(), txId],
					);
				}
			});
		},
		onSuccess: () => invalidateTransactionQueries(qc),
	});
}
