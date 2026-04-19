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
import { FX_ANCHOR_CURRENCY } from "./settings";

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
	a.name as account_name,
	t.amount as original_amount,
	upper(t.currency) as original_currency,
	coalesce(t.categorize_on, t.date) as eff_date,
	upper(s.reporting_currency) as reporting_currency,
	s.max_staleness_days as max_staleness_days,
	s.conversion_mode as conversion_mode
from transactions t
left join categories c on t.category_id = c.id
left join accounts a on t.account_id = a.id
cross join app_settings s`;

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

function buildConvertedRowsSql(baseSql: string, order: "asc" | "desc") {
	return `with
base_rows as (
	${baseSql}
),
distinct_pairs as (
	select distinct
		original_currency,
		eff_date,
		reporting_currency,
		conversion_mode,
		max_staleness_days
	from base_rows
),
tx_rates as (
	select
		p.original_currency,
		p.eff_date,
		p.reporting_currency,
		p.conversion_mode,
		p.max_staleness_days,
		case
			when p.original_currency = p.reporting_currency then 1.0
			else (
				select r.rate_to_anchor
				from fx_rates r
				where upper(r.currency) = p.original_currency
					and r.rate_date <= p.eff_date
					and (
						p.conversion_mode <> 'strict'
						or r.rate_date >= date(p.eff_date, '-' || p.max_staleness_days || ' days')
					)
				order by r.rate_date desc
				limit 1
			)
		end as tx_rate_to_anchor
	from distinct_pairs p
),
distinct_dates as (
	select distinct
		eff_date,
		reporting_currency,
		conversion_mode,
		max_staleness_days
	from base_rows
),
reporting_rates as (
	select
		d.eff_date,
		d.reporting_currency,
		d.conversion_mode,
		d.max_staleness_days,
		case
			when d.reporting_currency = upper(?) then 1.0
			else (
				select r.rate_to_anchor
				from fx_rates r
				where upper(r.currency) = d.reporting_currency
					and r.rate_date <= d.eff_date
					and (
						d.conversion_mode <> 'strict'
						or r.rate_date >= date(d.eff_date, '-' || d.max_staleness_days || ' days')
					)
				order by r.rate_date desc
				limit 1
			)
		end as reporting_rate_to_anchor
	from distinct_dates d
)
select
	b.id,
	b.date,
	b.categorize_on,
	b.amount,
	b.currency,
	b.counter_party,
	b.additional,
	b.notes,
	b.category_id,
	b.account_id,
	b.category_name,
	b.category_is_neutral,
	b.account_name,
	b.original_amount,
	b.original_currency,
	b.reporting_currency as converted_currency,
	case
		when b.original_currency = b.reporting_currency then b.original_amount
		when tx.tx_rate_to_anchor is null
			or rr.reporting_rate_to_anchor is null
			or rr.reporting_rate_to_anchor = 0 then null
		else b.original_amount * tx.tx_rate_to_anchor / rr.reporting_rate_to_anchor
	end as converted_amount
from base_rows b
left join tx_rates tx
	on tx.original_currency = b.original_currency
	and tx.eff_date = b.eff_date
	and tx.reporting_currency = b.reporting_currency
	and tx.conversion_mode = b.conversion_mode
	and tx.max_staleness_days = b.max_staleness_days
left join reporting_rates rr
	on rr.eff_date = b.eff_date
	and rr.reporting_currency = b.reporting_currency
	and rr.conversion_mode = b.conversion_mode
	and rr.max_staleness_days = b.max_staleness_days
order by b.date ${order}, b.id ${order}`;
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

	let baseSql = TRANSACTION_WITH_RELATIONS_SELECT_SQL;

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

	if (opts?.filters?.currency) {
		wheres.push("upper(t.currency) = upper(?)");
		params.push(opts.filters.currency);
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

	baseSql += " where " + wheres.join(" and ");

	const order = direction === "left" ? "asc" : "desc";
	baseSql += ` order by t.date ${order}, t.id ${order} limit ?`;
	params.push(limit + 1);
	const sql = buildConvertedRowsSql(baseSql, order);
	params.push(FX_ANCHOR_CURRENCY);

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
	const baseSql = `${TRANSACTION_WITH_RELATIONS_SELECT_SQL}
	where t.id = ? and t._sync_is_deleted = 0
	limit 1`;
	const sql = buildConvertedRowsSql(baseSql, "desc");
	const rows = await db.query<TransactionRow>(
		sql,
		[id, FX_ANCHOR_CURRENCY],
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
	original_amount: number;
	original_currency: string;
	converted_amount: number | null;
	converted_currency: string;
};

export function useCreateTransactionMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (tx: TransactionInput) => {
			const now = new Date().toISOString();
			await db.exec(
				`insert into transactions
				 (id, created_at, updated_at, date, amount, currency, counter_party, additional, notes, category_id, account_id, _sync_edited_at)
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
					Date.now(),
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
					_sync_status = 1,
					_sync_edited_at = ?
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
					Date.now(),
					txId,
				],
			);
		},
		onSuccess: () => invalidateTransactionQueries(qc),
	});
}

export type LinkedTransaction = {
	id: string;
	counter_party: string;
	amount: number;
	currency: string;
	date: string;
	original_amount: number;
	original_currency: string;
	converted_amount: number | null;
	converted_currency: string;
};

export function useTransactionLinksQuery(txId: string | undefined) {
	const db = useDb();
	return useQuery({
		queryKey: queryKeys.transactionLinks(txId),
		queryFn: () =>
			db.query<LinkedTransaction>(
				`with
				linked_rows as (
					select
						t.id,
						t.counter_party,
						t.amount,
						t.currency,
						t.date,
						t.amount as original_amount,
						upper(t.currency) as original_currency,
						coalesce(t.categorize_on, t.date) as eff_date,
						upper(s.reporting_currency) as reporting_currency,
						s.max_staleness_days as max_staleness_days,
						s.conversion_mode as conversion_mode
					from transaction_links l
					join transactions t on t.id = case
						when l.transaction_a_id = ? then l.transaction_b_id
						else l.transaction_a_id end
					cross join app_settings s
					where (l.transaction_a_id = ? or l.transaction_b_id = ?)
						and l._sync_is_deleted = 0
						and t._sync_is_deleted = 0
				),
				distinct_pairs as (
					select distinct
						original_currency,
						eff_date,
						reporting_currency,
						conversion_mode,
						max_staleness_days
					from linked_rows
				),
				tx_rates as (
					select
						p.original_currency,
						p.eff_date,
						p.reporting_currency,
						p.conversion_mode,
						p.max_staleness_days,
						case
							when p.original_currency = p.reporting_currency then 1.0
							else (
								select r.rate_to_anchor
								from fx_rates r
								where upper(r.currency) = p.original_currency
									and r.rate_date <= p.eff_date
									and (
										p.conversion_mode <> 'strict'
										or r.rate_date >= date(p.eff_date, '-' || p.max_staleness_days || ' days')
									)
								order by r.rate_date desc
								limit 1
							)
						end as tx_rate_to_anchor
					from distinct_pairs p
				),
				distinct_dates as (
					select distinct
						eff_date,
						reporting_currency,
						conversion_mode,
						max_staleness_days
					from linked_rows
				),
				reporting_rates as (
					select
						d.eff_date,
						d.reporting_currency,
						d.conversion_mode,
						d.max_staleness_days,
						case
							when d.reporting_currency = upper(?) then 1.0
							else (
								select r.rate_to_anchor
								from fx_rates r
								where upper(r.currency) = d.reporting_currency
									and r.rate_date <= d.eff_date
									and (
										d.conversion_mode <> 'strict'
										or r.rate_date >= date(d.eff_date, '-' || d.max_staleness_days || ' days')
									)
								order by r.rate_date desc
								limit 1
							)
						end as reporting_rate_to_anchor
					from distinct_dates d
				)
				select
					l.id,
					l.counter_party,
					l.amount,
					l.currency,
					l.date,
					l.original_amount,
					l.original_currency,
					l.reporting_currency as converted_currency,
					case
						when l.original_currency = l.reporting_currency then l.original_amount
						when tx.tx_rate_to_anchor is null
							or rr.reporting_rate_to_anchor is null
							or rr.reporting_rate_to_anchor = 0 then null
						else l.original_amount * tx.tx_rate_to_anchor / rr.reporting_rate_to_anchor
					end as converted_amount
				from linked_rows l
				left join tx_rates tx
					on tx.original_currency = l.original_currency
					and tx.eff_date = l.eff_date
					and tx.reporting_currency = l.reporting_currency
					and tx.conversion_mode = l.conversion_mode
					and tx.max_staleness_days = l.max_staleness_days
				left join reporting_rates rr
					on rr.eff_date = l.eff_date
					and rr.reporting_currency = l.reporting_currency
					and rr.conversion_mode = l.conversion_mode
					and rr.max_staleness_days = l.max_staleness_days
				order by l.date desc, l.id desc`,
				[txId, txId, txId, FX_ANCHOR_CURRENCY],
			),
		enabled: !!txId,
	});
}

export function useTransactionCurrenciesQuery() {
	const db = useDb();
	return useQuery({
		queryKey: [...queryKeyRoots.transactions, "currencies"],
		queryFn: async () =>
			db
				.query<{ currency: string }>(
					`select distinct currency
					from transactions
					where _sync_is_deleted = 0
					order by currency asc`,
				)
				.then((rows) => rows.map((row) => row.currency)),
	});
}

function invalidateLinksQueries(qc: ReturnType<typeof useQueryClient>) {
	qc.invalidateQueries({ queryKey: queryKeyRoots.transactionLinks });
}

export function useLinkTransactionMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async ({ aId, bId }: { aId: string; bId: string }) => {
			const [a, b] = aId < bId ? [aId, bId] : [bId, aId];
			const now = new Date().toISOString();
			await db.exec(
				`insert into transaction_links
					(transaction_a_id, transaction_b_id, created_at, updated_at, _sync_is_deleted, _sync_status, _sync_edited_at)
				values (?, ?, ?, ?, 0, 1, ?)
				on conflict (transaction_a_id, transaction_b_id) do update set
					_sync_is_deleted = 0,
					updated_at = excluded.updated_at,
					_sync_status = 1,
					_sync_edited_at = excluded._sync_edited_at`,
				[a, b, now, now, Date.now()],
			);
		},
		onSuccess: () => invalidateLinksQueries(qc),
	});
}

export function useUnlinkTransactionMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async ({ aId, bId }: { aId: string; bId: string }) => {
			const [a, b] = aId < bId ? [aId, bId] : [bId, aId];
			const now = new Date().toISOString();
			await db.exec(
				`update transaction_links set
					_sync_is_deleted = 1,
					updated_at = ?,
					_sync_status = 1,
					_sync_edited_at = ?
				where transaction_a_id = ? and transaction_b_id = ?`,
				[now, Date.now(), a, b],
			);
		},
		onSuccess: () => invalidateLinksQueries(qc),
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
							_sync_status = 1,
							_sync_edited_at = ?
						where id = ?`,
						[categoryId, now, Date.now(), txId],
					);
				}
			});
		},
		onSuccess: () => invalidateTransactionQueries(qc),
	});
}
