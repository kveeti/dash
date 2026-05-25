import { id } from "../id";
import type { DbHandle, DbSqlHandle } from "./client";
import { FX_ANCHOR_CURRENCY } from "./settings";
import {
	validateTransactionFlowCreate,
	type FlowEndpoint,
	type FlowUsage,
	type SuggestedTransactionFlow,
	type TransactionFlowKind,
} from "../transaction-flow-validation";
import {
	normalizeCurrency,
	parseDecimalToMinorUnits,
	type CurrencyMeta,
} from "../currency";
import { findCurrencyMeta } from "./currencies";
import type { TransactionTag } from "./tags";

export const DEFAULT_TRANSACTIONS_LIMIT = 50;

export type TransactionFilters = {
	category_id?: string;
	account_id?: string;
	currency?: string;
	currencies?: string[];
	uncategorized?: boolean;
	date_from?: string;
	date_to?: string;
	tag_ids?: string[];
};

export type TransactionSort =
	| "date_desc"
	| "date_asc"
	| "amount_desc"
	| "amount_asc"
	| "amount_abs_desc"
	| "amount_abs_asc"
	| "effective_amount_desc"
	| "effective_amount_asc"
	| "effective_amount_abs_desc"
	| "effective_amount_abs_asc"
	| "counter_party_asc"
	| "counter_party_desc"
	| "category_asc"
	| "account_asc";

export const DEFAULT_TRANSACTION_SORT: TransactionSort = "date_desc";

const TRANSACTION_SEARCH_BATCH_SIZE = 200;

const TRANSACTION_LIST_BASE_SELECT_SQL = `select
	t.id,
	t.date,
	t.amount_minor * 1.0 / coalesce(cm.minor_factor, 100) as amount,
	t.currency,
	t.counter_party,
	c.name as category_name,
	a.name as account_name,
	a.code as account_code,
	coalesce(fs.flow_count, 0) as flow_count,
	coalesce(fs.has_exchange, 0) as has_exchange,
	coalesce(fs.has_transfer, 0) as has_transfer,
	coalesce(fs.has_allocation, 0) as has_allocation,
	coalesce(fs.has_refund, 0) as has_refund,
	coalesce(fs.adjustment_minor, 0) as flow_adjustment_minor,
	t.amount_minor as original_amount_minor,
	t.amount_minor + coalesce(fs.adjustment_minor, 0) as effective_original_amount_minor,
	t.amount_minor * 1.0 / coalesce(cm.minor_factor, 100) as original_amount,
	(t.amount_minor + coalesce(fs.adjustment_minor, 0)) * 1.0 / coalesce(cm.minor_factor, 100) as effective_amount,
	t.currency as original_currency,
	coalesce(cm.minor_factor, 100) as original_minor_factor,
	coalesce(t.categorize_on, t.date) as eff_date,
	s.reporting_currency as reporting_currency,
	s.max_staleness_days as max_staleness_days,
	s.conversion_mode as conversion_mode
from transactions t
left join categories c on t.category_id = c.id
left join accounts a on t.account_id = a.id
left join (
	select
		tx_id,
		count(*) as flow_count,
		max(case when kind = 'currency_exchange' then 1 else 0 end) as has_exchange,
		max(case when kind = 'own_transfer' then 1 else 0 end) as has_transfer,
		max(case when kind = 'allocation' then 1 else 0 end) as has_allocation,
		max(case when kind = 'refund' then 1 else 0 end) as has_refund,
		sum(adjustment_minor) as adjustment_minor
	from (
		select
			from_transaction_id as tx_id,
			kind,
			case
				when kind in ('own_transfer', 'currency_exchange') then amount_minor
				else -amount_minor
			end as adjustment_minor
		from transaction_flows
		where _sync_is_deleted = 0
		union all
		select
			to_transaction_id as tx_id,
			kind,
			case
				when kind = 'currency_exchange' then -to_amount_minor
				when kind = 'own_transfer' then -amount_minor
				else amount_minor
			end as adjustment_minor
		from transaction_flows
		where _sync_is_deleted = 0
	)
	group by tx_id
) fs on fs.tx_id = t.id
left join currency_meta cm on cm.currency = t.currency
cross join app_settings s`;

const TRANSACTION_DETAIL_BASE_SELECT_SQL = `select
	t.id,
	t.date,
	t.amount_minor * 1.0 / coalesce(cm.minor_factor, 100) as amount,
	t.currency,
	t.counter_party,
	t.additional,
	t.notes,
	t.categorize_on,
	t.category_id,
	t.account_id,
	coalesce(a.name, '') as account_name,
	t.amount_minor as original_amount_minor,
	t.amount_minor * 1.0 / coalesce(cm.minor_factor, 100) as original_amount,
	t.currency as original_currency,
	coalesce(cm.minor_factor, 100) as original_minor_factor,
	coalesce(t.categorize_on, t.date) as eff_date,
	s.reporting_currency as reporting_currency,
	s.max_staleness_days as max_staleness_days,
	s.conversion_mode as conversion_mode
from transactions t
left join accounts a on t.account_id = a.id
left join currency_meta cm on cm.currency = t.currency
cross join app_settings s`;

const TRANSACTION_LIST_ROW_SELECT_SQL = `	b.id,
	b.date,
	b.amount,
	b.currency,
	b.counter_party,
	b.category_name,
	b.account_name,
	b.account_code,
	b.original_amount_minor,
	b.effective_original_amount_minor,
	b.effective_amount,
	b.flow_count,
	b.has_exchange,
	b.has_transfer,
	b.has_allocation,
	b.has_refund`;

const TRANSACTION_DETAIL_ROW_SELECT_SQL = `	b.id,
	b.date,
	b.amount,
	b.currency,
	b.counter_party,
	b.additional,
	b.notes,
	b.categorize_on,
	b.category_id,
	b.account_id,
	b.account_name`;

export type TransactionCursor = { left: string } | { right: string };
export type TransactionCursorInput = {
	left: string | undefined;
	right: string | undefined;
};
type CursorDirection = "left" | "right" | null;
type SortDirection = "asc" | "desc";

type TransactionSortClause = {
	currentExpr: string;
	cursorExpr: string;
	direction: SortDirection;
};

const EFFECTIVE_AMOUNT_MINOR_EXPR = "(t.amount_minor + coalesce(fs.adjustment_minor, 0))";
const CURSOR_EFFECTIVE_AMOUNT_MINOR_EXPR = `(
	select ct.amount_minor + coalesce(sum(adj.adjustment_minor), 0)
	from transactions ct
	left join (
		select
			from_transaction_id as tx_id,
			case
				when kind in ('own_transfer', 'currency_exchange') then amount_minor
				else -amount_minor
			end as adjustment_minor
		from transaction_flows
		where _sync_is_deleted = 0
		union all
		select
			to_transaction_id as tx_id,
			case
				when kind = 'currency_exchange' then -to_amount_minor
				when kind = 'own_transfer' then -amount_minor
				else amount_minor
			end as adjustment_minor
		from transaction_flows
		where _sync_is_deleted = 0
	) adj on adj.tx_id = ct.id
	where ct.id = ?
	group by ct.id
)`;

export type TransactionInput = {
	date: string;
	amount: string;
	currency: string;
	counter_party: string;
	additional?: string;
	notes?: string;
	categorize_on?: string | null;
	category_id?: string;
	account_id: string;
};

export function normalizeTransactionCursor(
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

export function normalizeTransactionSort(sort?: string): TransactionSort {
	switch (sort) {
		case "date_asc":
		case "amount_desc":
		case "amount_asc":
		case "amount_abs_desc":
		case "amount_abs_asc":
		case "effective_amount_desc":
		case "effective_amount_asc":
		case "effective_amount_abs_desc":
		case "effective_amount_abs_asc":
		case "counter_party_asc":
		case "counter_party_desc":
		case "category_asc":
		case "account_asc":
			return sort;
		default:
			return DEFAULT_TRANSACTION_SORT;
	}
}

function reverseDirection(direction: SortDirection): SortDirection {
	return direction === "asc" ? "desc" : "asc";
}

function getTransactionSortClauses(sort: TransactionSort): TransactionSortClause[] {
	switch (sort) {
		case "date_asc":
			return [
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "asc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "asc" },
			];
		case "amount_desc":
			return [
				{
					currentExpr: "t.amount_minor",
					cursorExpr: "(select ct.amount_minor from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "desc" },
			];
		case "amount_asc":
			return [
				{
					currentExpr: "t.amount_minor",
					cursorExpr: "(select ct.amount_minor from transactions ct where ct.id = ?)",
					direction: "asc",
				},
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "desc" },
			];
		case "amount_abs_desc":
			return [
				{
					currentExpr: "abs(t.amount_minor)",
					cursorExpr: "(select abs(ct.amount_minor) from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "desc" },
			];
		case "amount_abs_asc":
			return [
				{
					currentExpr: "abs(t.amount_minor)",
					cursorExpr: "(select abs(ct.amount_minor) from transactions ct where ct.id = ?)",
					direction: "asc",
				},
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "desc" },
			];
		case "effective_amount_desc":
			return [
				{
					currentExpr: EFFECTIVE_AMOUNT_MINOR_EXPR,
					cursorExpr: CURSOR_EFFECTIVE_AMOUNT_MINOR_EXPR,
					direction: "desc",
				},
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "desc" },
			];
		case "effective_amount_asc":
			return [
				{
					currentExpr: EFFECTIVE_AMOUNT_MINOR_EXPR,
					cursorExpr: CURSOR_EFFECTIVE_AMOUNT_MINOR_EXPR,
					direction: "asc",
				},
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "desc" },
			];
		case "effective_amount_abs_desc":
			return [
				{
					currentExpr: `abs(${EFFECTIVE_AMOUNT_MINOR_EXPR})`,
					cursorExpr: `abs(${CURSOR_EFFECTIVE_AMOUNT_MINOR_EXPR})`,
					direction: "desc",
				},
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "desc" },
			];
		case "effective_amount_abs_asc":
			return [
				{
					currentExpr: `abs(${EFFECTIVE_AMOUNT_MINOR_EXPR})`,
					cursorExpr: `abs(${CURSOR_EFFECTIVE_AMOUNT_MINOR_EXPR})`,
					direction: "asc",
				},
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "desc" },
			];
		case "counter_party_asc":
			return [
				{
					currentExpr: "lower(t.counter_party)",
					cursorExpr: "(select lower(ct.counter_party) from transactions ct where ct.id = ?)",
					direction: "asc",
				},
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "desc" },
			];
		case "counter_party_desc":
			return [
				{
					currentExpr: "lower(t.counter_party)",
					cursorExpr: "(select lower(ct.counter_party) from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "desc" },
			];
		case "category_asc":
			return [
				{
					currentExpr: "coalesce(lower(c.name), '')",
					cursorExpr:
						"(select coalesce(lower(cc.name), '') from transactions ct left join categories cc on ct.category_id = cc.id where ct.id = ?)",
					direction: "asc",
				},
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "desc" },
			];
		case "account_asc":
			return [
				{
					currentExpr: "coalesce(lower(a.name), '')",
					cursorExpr:
						"(select coalesce(lower(ca.name), '') from transactions ct left join accounts ca on ct.account_id = ca.id where ct.id = ?)",
					direction: "asc",
				},
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "desc" },
			];
		default:
			return [
				{
					currentExpr: "t.date",
					cursorExpr: "(select ct.date from transactions ct where ct.id = ?)",
					direction: "desc",
				},
				{ currentExpr: "t.id", cursorExpr: "?", direction: "desc" },
			];
	}
}

function cursorOperator(direction: SortDirection, after: boolean) {
	if (after) return direction === "asc" ? ">" : "<";
	return direction === "asc" ? "<" : ">";
}

function buildCursorPredicate(
	clauses: TransactionSortClause[],
	cursorId: string,
	after: boolean,
) {
	const params: string[] = [];
	const parts = clauses.map((clause, index) => {
		const equalParts = clauses.slice(0, index).map((previous) => {
			params.push(cursorId);
			return `${previous.currentExpr} = ${previous.cursorExpr}`;
		});
		params.push(cursorId);
		const comparePart = `${clause.currentExpr} ${cursorOperator(
			clause.direction,
			after,
		)} ${clause.cursorExpr}`;
		return `(${[...equalParts, comparePart].join(" and ")})`;
	});

	return {
		sql: `(${parts.join(" or ")})`,
		params,
	};
}

function buildSortedTransactionBaseSelectSql(clauses: TransactionSortClause[]) {
	const sortSelect = clauses
		.map((clause, index) => `\t${clause.currentExpr} as sort_${index},`)
		.join("\n");
	return TRANSACTION_LIST_BASE_SELECT_SQL.replace("select\n", `select\n${sortSelect}\n`);
}

function buildSortOrderSql(
	clauses: TransactionSortClause[],
	direction: CursorDirection,
	aliasPrefix = "",
) {
	const reverse = direction === "left";
	return clauses
		.map((clause, index) => {
			const queryDirection = reverse
				? reverseDirection(clause.direction)
				: clause.direction;
			return `${aliasPrefix}sort_${index} ${queryDirection}`;
		})
		.join(", ");
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

function buildConvertedRowsSql({
	baseSql,
	orderBySql,
	rowSelectSql,
	sortColumnCount = 0,
}: {
	baseSql: string;
	orderBySql: string;
	rowSelectSql: string;
	sortColumnCount?: number;
}) {
	const sortColumnSelectSql = Array.from(
		{ length: sortColumnCount },
		(_, index) => `	b.sort_${index}`,
	).join(",\n");

	// Tags are joined after base_rows so cursoring and limits apply to
	// transactions first, not to the expanded transaction/tag rowset.
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
				where r.currency = p.original_currency
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
			when d.reporting_currency = ? then 1.0
			else (
				select r.rate_to_anchor
				from fx_rates r
				where r.currency = d.reporting_currency
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
),
converted_rows as (
	select
${rowSelectSql}${sortColumnSelectSql ? `,\n${sortColumnSelectSql}` : ""},
	b.reporting_currency as converted_currency,
	case
		when b.original_currency = b.reporting_currency then b.original_amount
		when tx.tx_rate_to_anchor is null
			or rr.reporting_rate_to_anchor is null
			or rr.reporting_rate_to_anchor = 0 then null
		else cast(round(
			b.original_amount_minor * 1.0 / b.original_minor_factor
			* tx.tx_rate_to_anchor / rr.reporting_rate_to_anchor
			* coalesce(report_meta.minor_factor, 100)
		) as integer) * 1.0 / coalesce(report_meta.minor_factor, 100)
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
	left join currency_meta report_meta
		on report_meta.currency = b.reporting_currency
)
select
${rowSelectSql},
	b.converted_currency,
	b.converted_amount,
	tag.id as tag_id,
	tag.name as tag_name
from converted_rows b
left join transaction_tags tt
	on tt.transaction_id = b.id
	and tt._sync_is_deleted = 0
left join tags tag
	on tag.id = tt.tag_id
	and tag._sync_is_deleted = 0
order by ${orderBySql}, lower(tag.name) asc, tag.id asc`;
}

export function buildTransactionFtsQuery(search: string): string | null {
	const terms = Array.from(search.matchAll(/[\p{L}\p{N}]+/gu), ([term]) =>
		term.toLocaleLowerCase(),
	)
		.filter((term) => term.length > 0)
		.slice(0, 12);

	if (terms.length === 0) return null;
	return terms.map((term) => `${term}*`).join(" ");
}

export function escapeSqlLike(value: string) {
	return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function refreshTransactionSearchDocs(
	db: DbSqlHandle,
	txIds: string[],
) {
	const uniqueIds = Array.from(new Set(txIds)).filter(Boolean);
	for (let i = 0; i < uniqueIds.length; i += TRANSACTION_SEARCH_BATCH_SIZE) {
		const batch = uniqueIds.slice(i, i + TRANSACTION_SEARCH_BATCH_SIZE);
		const placeholders = batch.map(() => "?").join(", ");
		await db.exec(
			`delete from transaction_search_fts
			where tx_id in (${placeholders})`,
			batch,
		);
		await db.exec(
			`insert into transaction_search_fts (
				tx_id, counter_party, additional, notes
			)
			select
				id,
				counter_party,
				coalesce(additional, ''),
				coalesce(notes, '')
			from transactions
			where id in (${placeholders}) and _sync_is_deleted = 0`,
			batch,
		);
	}
}

export async function rebuildTransactionSearchIndex(db: DbHandle) {
	await db.exec("delete from transaction_search_fts");
	await db.exec(
		`insert into transaction_search_fts (
			tx_id, counter_party, additional, notes
		)
		select
			id,
			counter_party,
			coalesce(additional, ''),
			coalesce(notes, '')
		from transactions
		where _sync_is_deleted = 0`,
	);
}

export async function listTransactions(
	db: DbHandle,
	opts?: {
		search?: string;
		filters?: TransactionFilters;
		limit?: number;
		cursor?: TransactionCursor;
		sort?: TransactionSort;
	},
): Promise<TransactionsResult> {
	const limit = opts?.limit ?? DEFAULT_TRANSACTIONS_LIMIT;
	const sort = normalizeTransactionSort(opts?.sort);
	const sortClauses = getTransactionSortClauses(sort);

	let baseSql = buildSortedTransactionBaseSelectSql(sortClauses);

	const params: Array<string | number> = [];
	const wheres: string[] = ["t._sync_is_deleted = 0"];

	if (opts?.search) {
		const idLike = `%${escapeSqlLike(opts.search.trim())}%`;
		const ftsQuery = buildTransactionFtsQuery(opts.search);
		if (ftsQuery) {
			wheres.push(
				`(lower(t.id) like lower(?) escape '\\'
					or t.id in (
					select tx_id
					from transaction_search_fts
					where transaction_search_fts match ?
				))`,
			);
			params.push(idLike);
			params.push(ftsQuery);
		} else {
			wheres.push("lower(t.id) like lower(?) escape '\\'");
			params.push(idLike);
		}
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
		wheres.push("t.currency = ?");
		params.push(opts.filters.currency.toUpperCase());
	}

	if (opts?.filters?.currencies?.length) {
		const currencies = Array.from(new Set(opts.filters.currencies))
			.filter(Boolean)
			.map((currency) => currency.toUpperCase());
		if (currencies.length) {
			wheres.push(`t.currency in (${currencies.map(() => "?").join(", ")})`);
			params.push(...currencies);
		}
	}

	if (opts?.filters?.uncategorized) {
		wheres.push("t.category_id is null");
	}

	if (opts?.filters?.date_from) {
		wheres.push("t.date >= ?");
		params.push(opts.filters.date_from);
	}

	if (opts?.filters?.date_to) {
		wheres.push("t.date <= ?");
		params.push(opts.filters.date_to);
	}

	if (opts?.filters?.tag_ids?.length) {
		const tagIds = Array.from(new Set(opts.filters.tag_ids)).filter(Boolean);
		if (tagIds.length) {
			wheres.push(
				`t.id in (
					select tt.transaction_id
					from transaction_tags tt
					join tags tag on tag.id = tt.tag_id
					where tt._sync_is_deleted = 0
						and tag._sync_is_deleted = 0
						and tt.tag_id in (${tagIds.map(() => "?").join(", ")})
				)`,
			);
			params.push(...tagIds);
		}
	}

	let direction: CursorDirection = null;
	if (opts?.cursor) {
		if ("left" in opts.cursor) {
			direction = "left";
			const cursorId = opts.cursor.left;
			const cursorPredicate = buildCursorPredicate(sortClauses, cursorId, false);
			wheres.push(cursorPredicate.sql);
			params.push(...cursorPredicate.params);
		} else {
			direction = "right";
			const cursorId = opts.cursor.right;
			const cursorPredicate = buildCursorPredicate(sortClauses, cursorId, true);
			wheres.push(cursorPredicate.sql);
			params.push(...cursorPredicate.params);
		}
	}

	baseSql += " where " + wheres.join(" and ");

	const baseOrderBySql = buildSortOrderSql(sortClauses, direction);
	baseSql += ` order by ${baseOrderBySql} limit ?`;
	params.push(limit + 1);
	const sql = buildConvertedRowsSql({
		baseSql,
		orderBySql: buildSortOrderSql(sortClauses, direction, "b."),
		rowSelectSql: TRANSACTION_LIST_ROW_SELECT_SQL,
		sortColumnCount: sortClauses.length,
	});
	params.push(FX_ANCHOR_CURRENCY);

	const rows = foldTransactionRows(
		await db.query<RawTransactionRowWithTag>(sql, params),
	);

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

export async function getOneTransaction(
	db: DbHandle,
	id: string,
): Promise<TransactionDetails | null> {
	const baseSql = `${TRANSACTION_DETAIL_BASE_SELECT_SQL}
	where t.id = ? and t._sync_is_deleted = 0
	limit 1`;
	const sql = buildConvertedRowsSql({
		baseSql,
		orderBySql: "b.date desc, b.id desc",
		rowSelectSql: TRANSACTION_DETAIL_ROW_SELECT_SQL,
	});
	const rows = await db.query<RawTransactionDetailsWithTag>(
		sql,
		[id, FX_ANCHOR_CURRENCY],
	);
	return foldTransactionDetails(rows);
}

type RawTransactionBulkEditRow = {
	id: string;
	category_id: string | null;
	tag_id: string | null;
	tag_name: string | null;
};

export async function listTransactionBulkEditRows(
	db: DbHandle,
	txIds: string[],
): Promise<TransactionBulkEditRow[]> {
	const uniqueIds = Array.from(new Set(txIds)).filter(Boolean);
	if (!uniqueIds.length) return [];

	const placeholders = uniqueIds.map(() => "?").join(", ");
	const rows = await db.query<RawTransactionBulkEditRow>(
		`select
			t.id,
			t.category_id,
			tag.id as tag_id,
			tag.name as tag_name
		from transactions t
		left join transaction_tags tt
			on tt.transaction_id = t.id
			and tt._sync_is_deleted = 0
		left join tags tag
			on tag.id = tt.tag_id
			and tag._sync_is_deleted = 0
		where t._sync_is_deleted = 0
			and t.id in (${placeholders})
		order by t.id asc, lower(tag.name) asc, tag.id asc`,
		uniqueIds,
	);

	const transactions: TransactionBulkEditRow[] = [];
	const byId = new Map<string, TransactionBulkEditRow>();
	for (const row of rows) {
		let transaction = byId.get(row.id);
		if (!transaction) {
			transaction = { id: row.id, category_id: row.category_id, tags: [] };
			byId.set(row.id, transaction);
			transactions.push(transaction);
		}
		appendJoinedTag(transaction.tags, row);
	}
	return transactions;
}

export type TransactionsResult = {
	transactions: TransactionRow[];
	next_id: string | null;
	prev_id: string | null;
};

type TransactionWithConvertedAmount = {
	amount: number;
	currency: string;
	converted_amount: number | null;
	converted_currency: string;
};

export type TransactionRow = TransactionWithConvertedAmount & {
	id: string;
	date: Date;
	counter_party: string;
	category_name: string | null;
	account_name: string;
	account_code: string;
	original_amount_minor: number;
	effective_original_amount_minor: number;
	effective_amount: number;
	flow_count: number;
	has_exchange: number;
	has_transfer: number;
	has_allocation: number;
	has_refund: number;
	tags: TransactionTag[];
};

export type TransactionDetails = TransactionWithConvertedAmount & {
	id: string;
	date: Date;
	counter_party: string;
	additional: string | null;
	notes: string | null;
	categorize_on: string | null;
	category_id: string | null;
	account_id: string;
	account_name: string;
	tags: TransactionTag[];
};

export type TransactionBulkEditRow = {
	id: string;
	category_id: string | null;
	tags: TransactionTag[];
};

export async function createTransaction(
	db: DbHandle,
	tx: TransactionInput,
	currencyMeta: CurrencyMeta[],
) {
	const now = new Date().toISOString();
	const currency = normalizeCurrency(tx.currency);
	const amountMinor = parseDecimalToMinorUnits(
		tx.amount,
		findCurrencyMeta(currencyMeta, currency),
	);
	const newTxId = id();
	await db.withTx(async (txDb) => {
		await txDb.exec(
			`insert into transactions
			 (id, created_at, updated_at, date, amount_minor, currency, counter_party, additional, notes, category_id, account_id, _sync_edited_at)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				newTxId,
				now,
				now,
				tx.date,
				amountMinor,
				currency,
				tx.counter_party,
				tx.additional ?? null,
				tx.notes ?? null,
				tx.category_id ?? null,
				tx.account_id,
				Date.now(),
			],
		);
		await refreshTransactionSearchDocs(txDb, [newTxId]);
	});
}

export async function updateTransaction(
	db: DbHandle,
	txId: string,
	tx: TransactionInput,
	currencyMeta: CurrencyMeta[],
) {
	const now = new Date().toISOString();
	const currency = normalizeCurrency(tx.currency);
	const meta = findCurrencyMeta(currencyMeta, currency);
	await db.withTx(async (txDb) => {
		await txDb.exec(
			`update transactions set
				updated_at = ?,
				date = ?,
				amount_minor = ?,
				currency = ?,
				counter_party = ?,
				additional = ?,
				notes = ?,
				categorize_on = ?,
				category_id = ?,
				account_id = ?,
				_sync_status = 1,
				_sync_edited_at = ?
			where id = ?`,
			[
				now,
				tx.date,
				parseDecimalToMinorUnits(tx.amount, meta),
				currency,
				tx.counter_party,
				tx.additional ?? null,
				tx.notes ?? null,
				tx.categorize_on || null,
				tx.category_id ?? null,
				tx.account_id,
				Date.now(),
				txId,
			],
		);
		await refreshTransactionSearchDocs(txDb, [txId]);
	});
}

export async function updateTransactionQuickEdit(
	db: DbHandle,
	txId: string,
	input: {
		category_id?: string | null;
		categorize_on?: string | null;
	},
) {
	const assignments: string[] = [];
	const params: Array<string | number | null> = [];

	if ("category_id" in input) {
		assignments.push("category_id = ?");
		params.push(input.category_id || null);
	}

	if ("categorize_on" in input) {
		assignments.push("categorize_on = ?");
		params.push(input.categorize_on || null);
	}

	if (!assignments.length) return;

	await db.exec(
		`update transactions set
			${assignments.join(",\n\t\t\t")},
			updated_at = ?,
			_sync_status = 1,
			_sync_edited_at = ?
		where id = ?`,
		[...params, new Date().toISOString(), Date.now(), txId],
	);
}

export type { SuggestedTransactionFlow, TransactionFlowKind };

export type TransactionFlow = {
	id: string;
	kind: TransactionFlowKind;
	amount: number;
	currency: string;
	to_amount: number | null;
	to_currency: string | null;
	from_transaction_id: string;
	to_transaction_id: string;
	direction: "incoming" | "outgoing";
	other_transaction_id: string;
	other_counter_party: string;
	other_amount: number;
	other_currency: string;
	other_converted_amount: number | null;
	other_converted_currency: string;
};

export type TransactionLinkSuggestionKind =
	| "transfer_pair"
	| "refund_group";

export type TransactionLinkSuggestionMember = {
	id: string;
	date: Date;
	amount: number;
	currency: string;
	counter_party: string;
	account_name: string;
};

export type TransactionLinkSuggestion = {
	id: string;
	kind: TransactionLinkSuggestionKind;
	transaction_ids: string[];
	primary_transaction_id: string;
	score: number;
	confidence: "high" | "review";
	reason: string;
	evidence: string[];
	transactions: TransactionLinkSuggestionMember[];
	suggested_flows: SuggestedTransactionFlow[];
};

export type TransactionLinkSuggestionPageCursor = {
	before_date: string;
	before_id: string;
};

export type TransactionLinkSuggestionPageResult = {
	suggestions: TransactionLinkSuggestion[];
	next_cursor: TransactionLinkSuggestionPageCursor | null;
	scanned_count: number;
};

type JoinedTagColumns = {
	tag_id: string | null;
	tag_name: string | null;
};

type RawTransactionRow = Omit<TransactionRow, "date" | "tags"> & {
	date: string;
};

type RawTransactionDetails = Omit<TransactionDetails, "date" | "tags"> & {
	date: string;
};

type RawTransactionRowWithTag = RawTransactionRow & JoinedTagColumns;
type RawTransactionDetailsWithTag = RawTransactionDetails & JoinedTagColumns;

function toTransactionRow(row: RawTransactionRow): TransactionRow {
	return {
		id: row.id,
		date: new Date(row.date),
		amount: row.amount,
		currency: row.currency,
		converted_amount: row.converted_amount,
		converted_currency: row.converted_currency,
		counter_party: row.counter_party,
		category_name: row.category_name,
		account_name: row.account_name,
		account_code: row.account_code,
		original_amount_minor: row.original_amount_minor,
		effective_original_amount_minor: row.effective_original_amount_minor,
		effective_amount: row.effective_amount,
		flow_count: row.flow_count,
		has_exchange: row.has_exchange,
		has_transfer: row.has_transfer,
		has_allocation: row.has_allocation,
		has_refund: row.has_refund,
		tags: [],
	};
}

function toTransactionDetails(
	row: RawTransactionDetails,
): TransactionDetails {
	return {
		id: row.id,
		date: new Date(row.date),
		amount: row.amount,
		currency: row.currency,
		converted_amount: row.converted_amount,
		converted_currency: row.converted_currency,
		counter_party: row.counter_party,
		additional: row.additional,
		notes: row.notes,
		categorize_on: row.categorize_on,
		category_id: row.category_id,
		account_id: row.account_id,
		account_name: row.account_name,
		tags: [],
	};
}

function appendJoinedTag(
	tags: TransactionTag[],
	row: JoinedTagColumns,
) {
	if (!row.tag_id || !row.tag_name) return;
	if (tags.some((tag) => tag.id === row.tag_id)) return;
	tags.push({ id: row.tag_id, name: row.tag_name });
}

function foldTransactionRows(rows: RawTransactionRowWithTag[]): TransactionRow[] {
	const transactions: TransactionRow[] = [];
	const byId = new Map<string, TransactionRow>();

	for (const row of rows) {
		let transaction = byId.get(row.id);
		if (!transaction) {
			transaction = toTransactionRow(row);
			transactions.push(transaction);
			byId.set(transaction.id, transaction);
		}
		appendJoinedTag(transaction.tags, row);
	}

	return transactions;
}

function foldTransactionDetails(
	rows: RawTransactionDetailsWithTag[],
): TransactionDetails | null {
	let transaction: TransactionDetails | null = null;

	for (const row of rows) {
		if (!transaction) transaction = toTransactionDetails(row);
		appendJoinedTag(transaction.tags, row);
	}

	return transaction;
}

export async function listTransactionFlows(
	db: DbHandle,
	txId: string,
): Promise<TransactionFlow[]> {
	return db.query<TransactionFlow>(
		`with flow_rows as (
					select
						f.id,
						f.kind,
						f.amount_minor,
						f.amount_minor * 1.0 / coalesce(fm.minor_factor, 100) as amount,
						f.currency,
						f.to_amount_minor,
						case
							when f.to_amount_minor is null then null
							else f.to_amount_minor * 1.0 / coalesce(tfm.minor_factor, 100)
						end as to_amount,
						f.to_currency,
						f.from_transaction_id,
						f.to_transaction_id,
						case when f.to_transaction_id = ? then 'incoming' else 'outgoing' end as direction,
						t.id as other_transaction_id,
						t.counter_party as other_counter_party,
						t.amount_minor * 1.0 / coalesce(tm.minor_factor, 100) as other_amount,
						t.currency as other_currency,
						t.amount_minor as original_amount_minor,
						t.amount_minor * 1.0 / coalesce(tm.minor_factor, 100) as original_amount,
						t.currency as original_currency,
						coalesce(tm.minor_factor, 100) as original_minor_factor,
						coalesce(t.categorize_on, t.date) as eff_date,
						s.reporting_currency as reporting_currency,
						s.max_staleness_days as max_staleness_days,
						s.conversion_mode as conversion_mode
					from transaction_flows f
					join transactions t on t.id = case when f.from_transaction_id = ? then f.to_transaction_id else f.from_transaction_id end
					left join currency_meta fm on fm.currency = f.currency
					left join currency_meta tfm on tfm.currency = f.to_currency
					left join currency_meta tm on tm.currency = t.currency
					cross join app_settings s
					where (f.from_transaction_id = ? or f.to_transaction_id = ?)
						and f._sync_is_deleted = 0
						and t._sync_is_deleted = 0
				),
				distinct_pairs as (
					select distinct original_currency, eff_date, reporting_currency, conversion_mode, max_staleness_days from flow_rows
				),
				tx_rates as (
					select p.*, case when p.original_currency = p.reporting_currency then 1.0 else (
						select r.rate_to_anchor from fx_rates r
						where r.currency = p.original_currency and r.rate_date <= p.eff_date
							and (p.conversion_mode <> 'strict' or r.rate_date >= date(p.eff_date, '-' || p.max_staleness_days || ' days'))
						order by r.rate_date desc limit 1
					) end as tx_rate_to_anchor
					from distinct_pairs p
				),
				distinct_dates as (
					select distinct eff_date, reporting_currency, conversion_mode, max_staleness_days from flow_rows
				),
				reporting_rates as (
					select d.*, case when d.reporting_currency = ? then 1.0 else (
						select r.rate_to_anchor from fx_rates r
						where r.currency = d.reporting_currency and r.rate_date <= d.eff_date
							and (d.conversion_mode <> 'strict' or r.rate_date >= date(d.eff_date, '-' || d.max_staleness_days || ' days'))
						order by r.rate_date desc limit 1
					) end as reporting_rate_to_anchor
					from distinct_dates d
				)
				select
					fr.id, fr.kind, fr.amount, fr.currency, fr.from_transaction_id, fr.to_transaction_id, fr.direction,
					fr.to_amount, fr.to_currency,
					fr.other_transaction_id, fr.other_counter_party, fr.other_amount, fr.other_currency,
					fr.reporting_currency as other_converted_currency,
					case
						when fr.original_currency = fr.reporting_currency then fr.original_amount
						when tx.tx_rate_to_anchor is null or rr.reporting_rate_to_anchor is null or rr.reporting_rate_to_anchor = 0 then null
						else cast(round(
							fr.original_amount_minor * 1.0 / fr.original_minor_factor
							* tx.tx_rate_to_anchor / rr.reporting_rate_to_anchor
							* coalesce(report_meta.minor_factor, 100)
						) as integer) * 1.0 / coalesce(report_meta.minor_factor, 100)
					end as other_converted_amount
				from flow_rows fr
				left join tx_rates tx on tx.original_currency = fr.original_currency and tx.eff_date = fr.eff_date and tx.reporting_currency = fr.reporting_currency and tx.conversion_mode = fr.conversion_mode and tx.max_staleness_days = fr.max_staleness_days
				left join reporting_rates rr on rr.eff_date = fr.eff_date and rr.reporting_currency = fr.reporting_currency and rr.conversion_mode = fr.conversion_mode and rr.max_staleness_days = fr.max_staleness_days
				left join currency_meta report_meta on report_meta.currency = fr.reporting_currency
				order by fr.kind asc, fr.id desc`,
		[txId, txId, txId, txId, FX_ANCHOR_CURRENCY],
	);
}

type TransferSuggestionRow = {
	base_id: string;
	base_date: string;
	base_amount: number;
	base_currency: string;
	base_counter_party: string;
	base_account_name: string;
	candidate_id: string;
	candidate_date: string;
	candidate_amount: number;
	candidate_currency: string;
	candidate_counter_party: string;
	candidate_account_name: string;
	date_gap_days: number;
	score: number;
};

type LinkSuggestionTransactionRow = {
	id: string;
	date: string;
	amount: number;
	currency: string;
	counter_party: string;
	account_name: string;
};

type AvailableLinkSuggestionTransactionRow = LinkSuggestionTransactionRow & {
	available_amount: number;
};

type LinkSuggestionDismissalRow = {
	kind: TransactionLinkSuggestionKind;
	primary_transaction_id?: string;
	candidate_signature: string;
};

type FlowAmountTotalRow = { total: number | null };
type FlowEndpointRow = FlowEndpoint;
type FlowUsageRows = Partial<FlowUsage>;
type AmountFormatter = (amount: number, currency: string) => string;
type SuggestionPrimaryRow = LinkSuggestionTransactionRow & {
	account_id: string;
};
type RefundPairRow = {
	base_id: string;
	base_date: string;
	base_amount: number;
	base_currency: string;
	base_counter_party: string;
	base_account_name: string;
	candidate_id: string;
	candidate_date: string;
	candidate_amount: number;
	candidate_currency: string;
	candidate_counter_party: string;
	candidate_account_name: string;
	candidate_available_amount: number;
	date_gap_days: number;
};
type RefundCandidateBaseRow = LinkSuggestionTransactionRow & {
	remaining_amount: number;
	date_gap_days: number;
};
type FlowAmountByBaseRow = {
	base_id: string;
	currency: string;
	total: number | null;
};

const TRANSFER_SUGGESTION_MIN_SCORE = 40;
const REFUND_SUGGESTION_MIN_SCORE = 70;
const PAGE_SUGGESTION_MIN_SCORE = 60;
const SUGGESTION_PAGE_BATCH_SIZE = 120;
const SUGGESTION_PAGE_TARGET_COUNT = 60;

function suggestionConfidence(score: number): TransactionLinkSuggestion["confidence"] {
	return score >= 85 ? "high" : "review";
}

function sortedCandidateSignature(txIds: string[]): string {
	return [...txIds].sort().join("_");
}

function normalizeSuggestionText(value: string): string[] {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9åäö]+/gi, " ")
		.split(/\s+/)
		.map((part) => part.trim())
		.filter((part) => part.length >= 3);
}

function countTokenOverlap(a: string, b: string): number {
	const tokensA = new Set(normalizeSuggestionText(a));
	if (tokensA.size === 0) return 0;
	let overlap = 0;
	for (const token of normalizeSuggestionText(b)) {
		if (tokensA.has(token)) overlap++;
	}
	return overlap;
}

function daysBetween(a: string, b: string): number {
	const aTime = new Date(a).getTime();
	const bTime = new Date(b).getTime();
	if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return 0;
	return Math.round((bTime - aTime) / 86_400_000);
}

function getCombinations<T>(items: T[], size: number): T[][] {
	if (size <= 0) return [[]];
	if (items.length < size) return [];
	const result: T[][] = [];
	for (let i = 0; i <= items.length - size; i++) {
		for (const rest of getCombinations(items.slice(i + 1), size - 1)) {
			result.push([items[i], ...rest]);
		}
	}
	return result;
}

function toSuggestionMember(row: LinkSuggestionTransactionRow): TransactionLinkSuggestionMember {
	return {
		id: row.id,
		date: new Date(row.date),
		amount: row.amount,
		currency: row.currency,
		counter_party: row.counter_party,
		account_name: row.account_name,
	};
}

function isDismissed({ dismissals, kind, signature }: { dismissals: Set<string>; kind: TransactionLinkSuggestionKind; signature: string }) {
	return dismissals.has(`${kind}:${signature}`);
}

function allocationKindForSuggestion(kind: TransactionLinkSuggestionKind): TransactionFlowKind {
	if (kind === "transfer_pair") return "own_transfer";
	if (kind === "refund_group") return "refund";
	return "allocation";
}

function isPageSuggestion(suggestion: TransactionLinkSuggestion): boolean {
	return suggestion.kind === "transfer_pair" || suggestion.score >= PAGE_SUGGESTION_MIN_SCORE;
}

function buildGroupSuggestedFlows({
	kind,
	base,
	group,
	remainingAmount,
}: {
	kind: "refund_group";
	base: LinkSuggestionTransactionRow;
	group: AvailableLinkSuggestionTransactionRow[];
	remainingAmount: number;
}): SuggestedTransactionFlow[] {
	let remaining = remainingAmount;
	return group
		.filter((item) => item.available_amount > 0)
		.map((item) => {
			const amount = Math.min(item.available_amount, remaining);
			remaining = Math.max(0, remaining - amount);
			return {
				from_transaction_id: item.id,
				to_transaction_id: base.id,
				amount,
				currency: base.currency,
				kind: allocationKindForSuggestion(kind),
			};
		})
		.filter((flow) => flow.amount > 0);
}

export async function listTransactionLinkSuggestions(
	db: DbHandle,
	txId: string,
	formatAmount: AmountFormatter,
): Promise<TransactionLinkSuggestion[]> {
	const rows = await db.query<TransferSuggestionRow>(
		`with base as (
			select
				t.id,
				t.date,
				t.amount_minor,
				t.amount_minor * 1.0 / coalesce(cm.minor_factor, 100) as amount,
				t.currency,
				t.counter_party,
				t.account_id,
				coalesce(a.name, '') as account_name
			from transactions t
			left join accounts a on a.id = t.account_id
			left join currency_meta cm on cm.currency = t.currency
			where t.id = ? and t._sync_is_deleted = 0
			limit 1
		)
		select
			b.id as base_id, b.date as base_date, b.amount as base_amount, b.currency as base_currency,
			b.counter_party as base_counter_party, b.account_name as base_account_name,
			c.id as candidate_id, c.date as candidate_date, c.amount_minor * 1.0 / coalesce(ccm.minor_factor, 100) as candidate_amount, c.currency as candidate_currency,
			c.counter_party as candidate_counter_party, coalesce(ca.name, '') as candidate_account_name,
			abs(julianday(date(c.date)) - julianday(date(b.date))) as date_gap_days,
			100 - (abs(julianday(date(c.date)) - julianday(date(b.date))) * 10) as score
		from base b
		join transactions c on c.id <> b.id
			and c._sync_is_deleted = 0
			and c.currency = b.currency
			and c.account_id <> b.account_id
			and c.amount_minor = -b.amount_minor
			and abs(julianday(date(c.date)) - julianday(date(b.date))) <= 3
		left join accounts ca on ca.id = c.account_id
		left join currency_meta ccm on ccm.currency = c.currency
		where not exists (select 1 from transaction_flows f where f._sync_is_deleted = 0 and f.kind = 'own_transfer' and (f.from_transaction_id = b.id or f.to_transaction_id = b.id))
		and not exists (select 1 from transaction_flows f where f._sync_is_deleted = 0 and f.kind = 'own_transfer' and (f.from_transaction_id = c.id or f.to_transaction_id = c.id))
		and not exists (
			select 1 from transaction_link_suggestion_dismissals d
			where d.kind = 'transfer_pair' and d.primary_transaction_id = b.id and d.candidate_signature = c.id
		)
		order by score desc, c.date desc, c.id desc
		limit 5`,
		[txId],
	);

	const transferSuggestions = rows.filter((row) => row.score >= TRANSFER_SUGGESTION_MIN_SCORE).map((row) => {
		const signature = sortedCandidateSignature([row.candidate_id]);
		const fromId = row.base_amount < 0 ? row.base_id : row.candidate_id;
		const toId = row.base_amount > 0 ? row.base_id : row.candidate_id;
		return {
			id: `transfer_pair:${row.base_id}:${signature}`,
			kind: "transfer_pair" as const,
			transaction_ids: [row.base_id, row.candidate_id],
			primary_transaction_id: row.base_id,
			score: row.score,
			confidence: suggestionConfidence(row.score),
			reason: "possible own transfer",
			evidence: [
				"opposite signs",
				"same amount and currency",
				`${Math.round(row.date_gap_days)} day date gap`,
				"different accounts",
			],
			transactions: [
				{ id: row.base_id, date: new Date(row.base_date), amount: row.base_amount, currency: row.base_currency, counter_party: row.base_counter_party, account_name: row.base_account_name },
				{ id: row.candidate_id, date: new Date(row.candidate_date), amount: row.candidate_amount, currency: row.candidate_currency, counter_party: row.candidate_counter_party, account_name: row.candidate_account_name },
			],
			suggested_flows: [{ from_transaction_id: fromId, to_transaction_id: toId, amount: Math.abs(row.base_amount), currency: row.base_currency, kind: "own_transfer" as const }],
		};
	});

	const refundSuggestions = await getRefundLinkSuggestions(db, txId, formatAmount);
	return [...transferSuggestions, ...refundSuggestions]
		.sort((a, b) => b.score - a.score)
		.slice(0, 8);
}

export async function listTransactionLinkSuggestionPage(
	db: DbHandle,
	formatAmount: AmountFormatter,
	cursor?: { beforeDate?: string; beforeId?: string },
): Promise<TransactionLinkSuggestionPageResult> {
	const byId = new Map<string, TransactionLinkSuggestion>();
	const beforeDate = cursor?.beforeDate;
	const beforeId = cursor?.beforeId;
	let nextCursor: TransactionLinkSuggestionPageCursor | null = null;
	let scannedCount = 0;

	const hasCursor = !!beforeDate && !!beforeId;
	const rows = await db.query<SuggestionPrimaryRow>(
		`select
			t.id,
			t.date,
			t.amount_minor * 1.0 / coalesce(cm.minor_factor, 100) as amount,
			t.currency,
			t.counter_party,
			t.account_id,
			coalesce(a.name, '') as account_name
		from transactions t
		left join accounts a on a.id = t.account_id
		left join currency_meta cm on cm.currency = t.currency
		where t._sync_is_deleted = 0
			and t.amount_minor < 0
			${hasCursor ? "and (t.date < ? or (t.date = ? and t.id < ?))" : ""}
		order by t.date desc, t.id desc
		limit ${SUGGESTION_PAGE_BATCH_SIZE}`,
		hasCursor ? [beforeDate!, beforeDate!, beforeId!] : [],
	);

	if (rows.length > 0) {
		scannedCount = rows.length;

		const [transferSuggestions, refundSuggestions] = await Promise.all([
			getTransferSuggestionsForPrimaryRows(db, rows),
			getRefundSuggestionsForPrimaryRows(db, rows, formatAmount),
		]);
		for (const suggestion of [...transferSuggestions, ...refundSuggestions]) {
			byId.set(suggestion.id, suggestion);
		}

		const lastScanned = rows[rows.length - 1];
		nextCursor =
			rows.length === SUGGESTION_PAGE_BATCH_SIZE
				? {
						before_date: lastScanned.date,
						before_id: lastScanned.id,
					}
				: null;
	}

	const suggestions = [...byId.values()]
		.filter(isPageSuggestion)
		.sort((a, b) => b.score - a.score)
		.slice(0, SUGGESTION_PAGE_TARGET_COUNT);
	return {
		suggestions,
		next_cursor: nextCursor,
		scanned_count: scannedCount,
	};
}

async function getTransferSuggestionsForPrimaryRows(
	db: DbHandle,
	primaryRows: SuggestionPrimaryRow[],
): Promise<TransactionLinkSuggestion[]> {
	const primaryIds = [...new Set(primaryRows.map((row) => row.id))];
	if (primaryIds.length === 0) return [];
	const placeholders = primaryIds.map(() => "?").join(", ");

	const rows = await db.query<TransferSuggestionRow>(
		`with base as (
			select
				t.id,
				t.date,
				t.amount_minor,
				t.amount_minor * 1.0 / coalesce(cm.minor_factor, 100) as amount,
				t.currency,
				t.counter_party,
				t.account_id,
				coalesce(a.name, '') as account_name
			from transactions t
			left join accounts a on a.id = t.account_id
			left join currency_meta cm on cm.currency = t.currency
			where t.id in (${placeholders}) and t._sync_is_deleted = 0 and t.amount_minor < 0
		)
		select
			b.id as base_id, b.date as base_date, b.amount as base_amount, b.currency as base_currency,
			b.counter_party as base_counter_party, b.account_name as base_account_name,
			c.id as candidate_id, c.date as candidate_date, c.amount_minor * 1.0 / coalesce(ccm.minor_factor, 100) as candidate_amount, c.currency as candidate_currency,
			c.counter_party as candidate_counter_party, coalesce(ca.name, '') as candidate_account_name,
			abs(julianday(date(c.date)) - julianday(date(b.date))) as date_gap_days,
			100 - (abs(julianday(date(c.date)) - julianday(date(b.date))) * 10) as score
		from base b
		join transactions c on c.id <> b.id
			and c._sync_is_deleted = 0
			and c.currency = b.currency
			and c.account_id <> b.account_id
			and c.amount_minor = -b.amount_minor
			and abs(julianday(date(c.date)) - julianday(date(b.date))) <= 3
		left join accounts ca on ca.id = c.account_id
		left join currency_meta ccm on ccm.currency = c.currency
		where not exists (
				select 1
				from transaction_flows f
				where f._sync_is_deleted = 0
					and f.kind = 'own_transfer'
					and (f.from_transaction_id = b.id or f.to_transaction_id = b.id)
			)
			and not exists (
				select 1
				from transaction_flows f
				where f._sync_is_deleted = 0
					and f.kind = 'own_transfer'
					and (f.from_transaction_id = c.id or f.to_transaction_id = c.id)
			)
			and not exists (
				select 1 from transaction_link_suggestion_dismissals d
				where d.kind = 'transfer_pair' and d.primary_transaction_id = b.id and d.candidate_signature = c.id
			)
		order by b.date desc, b.id desc, score desc, c.date desc, c.id desc`,
		primaryIds,
	);

	const suggestions: TransactionLinkSuggestion[] = [];
	const perBaseCount = new Map<string, number>();
	for (const row of rows) {
		if (row.score < TRANSFER_SUGGESTION_MIN_SCORE) continue;
		const count = perBaseCount.get(row.base_id) ?? 0;
		if (count >= 5) continue;
		perBaseCount.set(row.base_id, count + 1);

		const signature = sortedCandidateSignature([row.candidate_id]);
		const fromId = row.base_amount < 0 ? row.base_id : row.candidate_id;
		const toId = row.base_amount > 0 ? row.base_id : row.candidate_id;
		suggestions.push({
			id: `transfer_pair:${row.base_id}:${signature}`,
			kind: "transfer_pair",
			transaction_ids: [row.base_id, row.candidate_id],
			primary_transaction_id: row.base_id,
			score: row.score,
			confidence: suggestionConfidence(row.score),
			reason: "possible own transfer",
			evidence: [
				"opposite signs",
				"same amount and currency",
				`${Math.round(row.date_gap_days)} day date gap`,
				"different accounts",
			],
			transactions: [
				{ id: row.base_id, date: new Date(row.base_date), amount: row.base_amount, currency: row.base_currency, counter_party: row.base_counter_party, account_name: row.base_account_name },
				{ id: row.candidate_id, date: new Date(row.candidate_date), amount: row.candidate_amount, currency: row.candidate_currency, counter_party: row.candidate_counter_party, account_name: row.candidate_account_name },
			],
			suggested_flows: [
				{
					from_transaction_id: fromId,
					to_transaction_id: toId,
					amount: Math.abs(row.base_amount),
					currency: row.base_currency,
					kind: "own_transfer",
				},
			],
		});
	}

	return suggestions;
}

async function getRefundSuggestionsForPrimaryRows(
	db: DbHandle,
	primaryRows: SuggestionPrimaryRow[],
	formatAmount: AmountFormatter,
): Promise<TransactionLinkSuggestion[]> {
	const bases = primaryRows.filter((row) => row.amount < 0);
	const baseIds = [...new Set(bases.map((row) => row.id))];
	if (baseIds.length === 0) return [];
	const placeholders = baseIds.map(() => "?").join(", ");

	const incomingRows = await db.query<FlowAmountByBaseRow>(
		`select
			f.to_transaction_id as base_id,
			f.currency,
			sum(f.amount_minor) * 1.0 / coalesce(cm.minor_factor, 100) as total
		from transaction_flows f
		left join currency_meta cm on cm.currency = f.currency
		where f.to_transaction_id in (${placeholders})
			and f._sync_is_deleted = 0
			and f.kind in ('allocation', 'refund')
		group by f.to_transaction_id, f.currency`,
		baseIds,
	);
	const incomingByBase = new Map(
		incomingRows.map((row) => [`${row.base_id}:${row.currency}`, row.total ?? 0]),
	);

	const dismissalRows = await db.query<LinkSuggestionDismissalRow>(
		`select
			kind,
			primary_transaction_id,
			candidate_signature
		from transaction_link_suggestion_dismissals
		where kind = 'refund_group'
			and primary_transaction_id in (${placeholders})`,
		baseIds,
	);
	const dismissalsByBase = new Map<string, Set<string>>();
	for (const row of dismissalRows) {
		if (!row.primary_transaction_id) continue;
		const set = dismissalsByBase.get(row.primary_transaction_id) ?? new Set<string>();
		set.add(`${row.kind}:${row.candidate_signature}`);
		dismissalsByBase.set(row.primary_transaction_id, set);
	}

	const pairs = await db.query<RefundPairRow>(
		`with base as (
			select
				t.id,
				t.date,
				t.amount_minor,
				t.amount_minor * 1.0 / coalesce(cm.minor_factor, 100) as amount,
				t.currency,
				t.counter_party,
				coalesce(a.name, '') as account_name
			from transactions t
			left join accounts a on a.id = t.account_id
			left join currency_meta cm on cm.currency = t.currency
			where t.id in (${placeholders}) and t._sync_is_deleted = 0 and t.amount_minor < 0
		),
		candidate_used as (
			select
				f.from_transaction_id as candidate_id,
				f.currency,
				sum(f.amount_minor) as total_minor
			from transaction_flows f
			where f._sync_is_deleted = 0
				and f.kind in ('allocation', 'refund', 'own_transfer')
			group by f.from_transaction_id, f.currency
		)
		select
			b.id as base_id,
			b.date as base_date,
			b.amount as base_amount,
			b.currency as base_currency,
			b.counter_party as base_counter_party,
			b.account_name as base_account_name,
			c.id as candidate_id,
			c.date as candidate_date,
			c.amount_minor * 1.0 / coalesce(ccm.minor_factor, 100) as candidate_amount,
			c.currency as candidate_currency,
			c.counter_party as candidate_counter_party,
			coalesce(ca.name, '') as candidate_account_name,
			(c.amount_minor - coalesce(u.total_minor, 0)) * 1.0 / coalesce(ccm.minor_factor, 100) as candidate_available_amount,
			julianday(date(c.date)) - julianday(date(b.date)) as date_gap_days
		from base b
		join transactions c on c.id <> b.id
			and c._sync_is_deleted = 0
			and c.currency = b.currency
			and c.amount_minor > 0
			and julianday(date(c.date)) - julianday(date(b.date)) between 0 and 45
		left join accounts ca on ca.id = c.account_id
		left join currency_meta ccm on ccm.currency = c.currency
		left join candidate_used u on u.candidate_id = c.id and u.currency = c.currency
		where not exists (
			select 1
			from transaction_flows f
			where f._sync_is_deleted = 0
				and f.from_transaction_id = c.id
				and f.to_transaction_id = b.id
				and f.kind in ('allocation', 'refund')
		)
		order by b.date desc, b.id desc, date_gap_days asc, c.date desc, c.id desc`,
		baseIds,
	);

	const pairsByBase = new Map<string, RefundPairRow[]>();
	for (const pair of pairs) {
		const list = pairsByBase.get(pair.base_id) ?? [];
		list.push(pair);
		pairsByBase.set(pair.base_id, list);
	}

	const suggestions: TransactionLinkSuggestion[] = [];
	for (const base of bases) {
		const remainingAmount = Math.max(
			0,
			Math.abs(base.amount) - (incomingByBase.get(`${base.id}:${base.currency}`) ?? 0),
		);
		if (remainingAmount <= 0) continue;
		const dismissals = dismissalsByBase.get(base.id) ?? new Set<string>();

		const candidateRows = (pairsByBase.get(base.id) ?? [])
			.filter((row) => row.candidate_available_amount > 0)
			.filter((row) => countTokenOverlap(base.counter_party, row.candidate_counter_party) > 0)
			.slice(0, 24);

		for (const row of candidateRows.slice(0, 12)) {
			const signature = sortedCandidateSignature([row.candidate_id]);
			if (dismissals.has(`refund_group:${signature}`)) continue;
			const availableAmount = row.candidate_available_amount;
			const coverage = availableAmount / remainingAmount;
			if (coverage < 0.15 || coverage > 1.05) continue;
			const overlap = countTokenOverlap(base.counter_party, row.candidate_counter_party);
			const avgGap = Math.max(0, row.date_gap_days);
			const exactish = Math.abs(coverage - 1) <= 0.02;
			const score = 60 + Math.min(22, coverage * 22) + Math.min(18, overlap * 6) + (exactish ? 15 : 0) - avgGap / 3;
			if (score < REFUND_SUGGESTION_MIN_SCORE) continue;
			const suggestedAmount = Math.min(availableAmount, remainingAmount);
			suggestions.push({
				id: `refund_group:${base.id}:${signature}`,
				kind: "refund_group",
				transaction_ids: [base.id, row.candidate_id],
				primary_transaction_id: base.id,
				score,
				confidence: suggestionConfidence(score),
				reason: "possible refund",
				evidence: [
					"later incoming payment",
					`${formatAmount(suggestedAmount, base.currency)} of ${formatAmount(remainingAmount, base.currency)} remaining`,
					"counterparty text overlap",
				],
				transactions: [
					{
						id: base.id,
						date: new Date(base.date),
						amount: base.amount,
						currency: base.currency,
						counter_party: base.counter_party,
						account_name: base.account_name,
					},
					{
						id: row.candidate_id,
						date: new Date(row.candidate_date),
						amount: row.candidate_amount,
						currency: row.candidate_currency,
						counter_party: row.candidate_counter_party,
						account_name: row.candidate_account_name,
					},
				],
				suggested_flows: [
					{
						from_transaction_id: row.candidate_id,
						to_transaction_id: base.id,
						amount: suggestedAmount,
						currency: base.currency,
						kind: "refund",
					},
				],
			});
		}
	}

	return suggestions.sort((a, b) => b.score - a.score);
}

async function getRefundLinkSuggestions(
	db: DbHandle,
	txId: string,
	formatAmount: AmountFormatter,
): Promise<TransactionLinkSuggestion[]> {
	const baseRows = await db.query<LinkSuggestionTransactionRow>(
		`select
			t.id,
			t.date,
			t.amount_minor * 1.0 / coalesce(cm.minor_factor, 100) as amount,
			t.currency,
			t.counter_party,
			coalesce(a.name, '') as account_name
		from transactions t
		left join accounts a on a.id = t.account_id
		left join currency_meta cm on cm.currency = t.currency
		where t.id = ? and t._sync_is_deleted = 0
		limit 1`,
		[txId],
	);
	const base = baseRows[0];
	if (!base) return [];
	if (base.amount > 0) {
		return getRefundLinkSuggestionsForPositiveCandidate(db, txId, formatAmount);
	}
	if (base.amount >= 0) return [];

	const incomingFlowRows = await db.query<FlowAmountTotalRow>(
		`select sum(f.amount_minor) * 1.0 / coalesce(cm.minor_factor, 100) as total
		from transaction_flows f
		left join currency_meta cm on cm.currency = f.currency
		where f.to_transaction_id = ?
			and f._sync_is_deleted = 0
			and f.currency = ?
			and f.kind in ('allocation', 'refund')`,
		[txId, base.currency],
	);
	const incomingFlowTotal = incomingFlowRows[0]?.total ?? 0;
	const remainingAmount = Math.max(0, Math.abs(base.amount) - incomingFlowTotal);
	if (remainingAmount <= 0) return [];

	const dismissalRows = await db.query<LinkSuggestionDismissalRow>(
		`select kind, candidate_signature from transaction_link_suggestion_dismissals where primary_transaction_id = ?`,
		[txId],
	);
	const dismissals = new Set(dismissalRows.map((row) => `${row.kind}:${row.candidate_signature}`));

	const candidates = await db.query<AvailableLinkSuggestionTransactionRow>(
		`select
			c.id,
			c.date,
			c.amount_minor * 1.0 / coalesce(cm.minor_factor, 100) as amount,
			c.currency,
			c.counter_party,
			coalesce(a.name, '') as account_name,
			(c.amount_minor - coalesce((
				select sum(f.amount_minor)
				from transaction_flows f
				where f.from_transaction_id = c.id
					and f._sync_is_deleted = 0
					and f.currency = c.currency
					and f.kind in ('allocation', 'refund', 'own_transfer')
			), 0)) * 1.0 / coalesce(cm.minor_factor, 100) as available_amount
		from transactions c
		left join accounts a on a.id = c.account_id
		left join currency_meta cm on cm.currency = c.currency
		where c.id <> ?
			and c._sync_is_deleted = 0
			and c.currency = ?
			and c.amount_minor > 0
			and julianday(date(c.date)) - julianday(date(?)) between 0 and 45
			and not exists (
				select 1 from transaction_flows f
				where f._sync_is_deleted = 0
					and f.from_transaction_id = c.id
					and f.to_transaction_id = ?
					and f.kind in ('allocation', 'refund')
			)
		order by abs(julianday(date(c.date)) - julianday(date(?))) asc, c.date desc
		limit 24`,
		[txId, base.currency, base.date, txId, base.date],
	);
	const availableCandidates = candidates.filter((candidate) => candidate.available_amount > 0);
	const suggestions: TransactionLinkSuggestion[] = [];

	const refundCandidates = availableCandidates
		.filter((candidate) => {
			const gap = daysBetween(base.date, candidate.date);
			return gap >= 0 && gap <= 45 && countTokenOverlap(base.counter_party, candidate.counter_party) > 0;
		})
		.slice(0, 12);

	for (const groupSize of [1]) {
		for (const group of getCombinations(refundCandidates, groupSize)) {
			const signature = sortedCandidateSignature(group.map((item) => item.id));
			if (isDismissed({ dismissals, kind: "refund_group", signature })) continue;
			const sum = group.reduce((total, item) => total + item.available_amount, 0);
			const coverage = sum / remainingAmount;
			if (coverage < 0.15 || coverage > 1.05) continue;
			const overlap = group.reduce((total, item) => total + countTokenOverlap(base.counter_party, item.counter_party), 0);
			if (overlap <= 0) continue;
			const avgGap = group.reduce((total, item) => total + Math.max(0, daysBetween(base.date, item.date)), 0) / group.length;
			const exactish = Math.abs(coverage - 1) <= 0.02;
			const score = 60 + Math.min(22, coverage * 22) + Math.min(18, overlap * 6) + (exactish ? 15 : 0) - avgGap / 3;
			if (score < REFUND_SUGGESTION_MIN_SCORE) continue;
			suggestions.push({
				id: `refund_group:${txId}:${signature}`,
				kind: "refund_group",
				transaction_ids: [txId, ...group.map((item) => item.id)],
				primary_transaction_id: txId,
				score,
				confidence: suggestionConfidence(score),
				reason: "possible refund",
				evidence: [
					group.length === 1
						? "later incoming payment"
						: `${group.length} later incoming payments`,
					`${formatAmount(sum, base.currency)} of ${formatAmount(remainingAmount, base.currency)} remaining`,
					"counterparty text overlap",
				],
				transactions: [base, ...group].map(toSuggestionMember),
				suggested_flows: buildGroupSuggestedFlows({ kind: "refund_group", base, group, remainingAmount }),
			});
		}
	}

	return suggestions.sort((a, b) => b.score - a.score).slice(0, 6);
}

async function getRefundLinkSuggestionsForPositiveCandidate(
	db: DbHandle,
	txId: string,
	formatAmount: AmountFormatter,
): Promise<TransactionLinkSuggestion[]> {
	const candidateRows = await db.query<AvailableLinkSuggestionTransactionRow>(
		`select
			c.id,
			c.date,
			c.amount_minor * 1.0 / coalesce(cm.minor_factor, 100) as amount,
			c.currency,
			c.counter_party,
			coalesce(a.name, '') as account_name,
			(c.amount_minor - coalesce((
				select sum(f.amount_minor)
				from transaction_flows f
				where f.from_transaction_id = c.id
					and f._sync_is_deleted = 0
					and f.currency = c.currency
					and f.kind in ('allocation', 'refund', 'own_transfer')
			), 0)) * 1.0 / coalesce(cm.minor_factor, 100) as available_amount
		from transactions c
		left join accounts a on a.id = c.account_id
		left join currency_meta cm on cm.currency = c.currency
		where c.id = ?
			and c._sync_is_deleted = 0
			and c.amount_minor > 0
		limit 1`,
		[txId],
	);
	const candidate = candidateRows[0];
	if (!candidate || candidate.available_amount <= 0) return [];

	const candidateSignature = sortedCandidateSignature([candidate.id]);
	const baseRows = await db.query<RefundCandidateBaseRow>(
		`select
			b.id,
			b.date,
			b.amount_minor * 1.0 / coalesce(cm.minor_factor, 100) as amount,
			b.currency,
			b.counter_party,
			coalesce(a.name, '') as account_name,
			(abs(b.amount_minor) - coalesce(u.total_minor, 0)) * 1.0 / coalesce(cm.minor_factor, 100) as remaining_amount,
			julianday(date(?)) - julianday(date(b.date)) as date_gap_days
		from transactions b
		left join accounts a on a.id = b.account_id
		left join currency_meta cm on cm.currency = b.currency
		left join (
			select
				f.to_transaction_id as base_id,
				f.currency,
				sum(f.amount_minor) as total_minor
			from transaction_flows f
			where f._sync_is_deleted = 0
				and f.kind in ('allocation', 'refund')
			group by f.to_transaction_id, f.currency
		) u on u.base_id = b.id and u.currency = b.currency
		where b.id <> ?
			and b._sync_is_deleted = 0
			and b.currency = ?
			and b.amount_minor < 0
			and julianday(date(?)) - julianday(date(b.date)) between 0 and 45
			and not exists (
				select 1 from transaction_flows f
				where f._sync_is_deleted = 0
					and f.from_transaction_id = ?
					and f.to_transaction_id = b.id
					and f.kind in ('allocation', 'refund')
			)
			and not exists (
				select 1 from transaction_link_suggestion_dismissals d
				where d.kind = 'refund_group'
					and d.primary_transaction_id = b.id
					and d.candidate_signature = ?
			)
		order by date_gap_days asc, b.date desc, b.id desc
		limit 24`,
		[
			candidate.date,
			candidate.id,
			candidate.currency,
			candidate.date,
			candidate.id,
			candidateSignature,
		],
	);

	const suggestions: TransactionLinkSuggestion[] = [];
	for (const base of baseRows
		.filter((row) => row.remaining_amount > 0)
		.filter((row) => countTokenOverlap(row.counter_party, candidate.counter_party) > 0)
		.slice(0, 12)) {
		const coverage = candidate.available_amount / base.remaining_amount;
		if (coverage < 0.15 || coverage > 1.05) continue;
		const overlap = countTokenOverlap(base.counter_party, candidate.counter_party);
		const avgGap = Math.max(0, base.date_gap_days);
		const exactish = Math.abs(coverage - 1) <= 0.02;
		const score = 60 + Math.min(22, coverage * 22) + Math.min(18, overlap * 6) + (exactish ? 15 : 0) - avgGap / 3;
		if (score < REFUND_SUGGESTION_MIN_SCORE) continue;
		const suggestedAmount = Math.min(candidate.available_amount, base.remaining_amount);
		suggestions.push({
			id: `refund_group:${base.id}:${candidateSignature}`,
			kind: "refund_group",
			transaction_ids: [base.id, candidate.id],
			primary_transaction_id: base.id,
			score,
			confidence: suggestionConfidence(score),
			reason: "possible refund",
			evidence: [
				"later incoming payment",
				`${formatAmount(suggestedAmount, base.currency)} of ${formatAmount(base.remaining_amount, base.currency)} remaining`,
				"counterparty text overlap",
			],
			transactions: [base, candidate].map(toSuggestionMember),
			suggested_flows: [
				{
					from_transaction_id: candidate.id,
					to_transaction_id: base.id,
					amount: suggestedAmount,
					currency: base.currency,
					kind: "refund",
				},
			],
		});
	}

	return suggestions.sort((a, b) => b.score - a.score).slice(0, 6);
}

export async function listTransactionCurrencies(db: DbHandle): Promise<string[]> {
	return db.query<{ currency: string }>(
		`select distinct currency from transactions where _sync_is_deleted = 0 order by currency asc`,
	).then((rows) => rows.map((row) => row.currency));
}

export async function createTransactionFlow(
	db: DbHandle,
	flow: SuggestedTransactionFlow,
	currencyMeta: CurrencyMeta[],
) {
	if (flow.from_transaction_id === flow.to_transaction_id || flow.amount <= 0) return;
	const now = new Date().toISOString();
	const currency = normalizeCurrency(flow.currency);
	const meta = findCurrencyMeta(currencyMeta, currency);
	const amountMinor = parseDecimalToMinorUnits(
		flow.amount.toFixed(meta.minor_unit),
		meta,
	);
	if (amountMinor <= 0) return;
	const toCurrency =
		flow.kind === "currency_exchange" && flow.to_currency
			? normalizeCurrency(flow.to_currency)
			: null;
	let toAmountMinor: number | null = null;
	if (flow.kind === "currency_exchange" && flow.to_amount != null && toCurrency) {
		const toMeta = findCurrencyMeta(currencyMeta, toCurrency);
		toAmountMinor = parseDecimalToMinorUnits(
			flow.to_amount.toFixed(toMeta.minor_unit),
			toMeta,
		);
	}
	if (flow.kind === "currency_exchange" && (!toAmountMinor || toAmountMinor <= 0 || !toCurrency)) {
		return;
	}
	const endpoints = await db.query<FlowEndpointRow>(
		`select id, amount_minor, currency
		from transactions
		where id in (?, ?) and _sync_is_deleted = 0`,
		[flow.from_transaction_id, flow.to_transaction_id],
	);
	const fromTx = endpoints.find((tx) => tx.id === flow.from_transaction_id);
	const toTx = endpoints.find((tx) => tx.id === flow.to_transaction_id);
	if (!fromTx || !toTx) return;
	const fromCurrency = normalizeCurrency(fromTx.currency);
	const endpointToCurrency = normalizeCurrency(toTx.currency);
	if (currency !== fromCurrency) return;
	const usageKinds =
		flow.kind === "allocation" || flow.kind === "refund"
			? ["allocation", "refund"]
			: [flow.kind];
	const usage = (
		await db.query<FlowUsageRows>(
			`select
				coalesce(sum(case
					when from_transaction_id = ? and currency = ? then amount_minor
					else 0
				end), 0) as from_used_minor,
				coalesce(sum(case
					when to_transaction_id = ? and (
						(kind = 'currency_exchange' and to_currency = ?)
						or
						(kind <> 'currency_exchange' and currency = ?)
					) then case
						when kind = 'currency_exchange' then to_amount_minor
						else amount_minor
					end
					else 0
				end), 0) as to_used_minor
			from transaction_flows
			where _sync_is_deleted = 0
				and kind in (${usageKinds.map(() => "?").join(",")})
				and (
					from_transaction_id = ?
					or to_transaction_id = ?
				)`,
			[
				flow.from_transaction_id,
				currency,
				flow.to_transaction_id,
				toCurrency ?? currency,
				toCurrency ?? currency,
				...usageKinds,
				flow.from_transaction_id,
				flow.to_transaction_id,
			],
		)
	)[0];
	const fromUsedMinor = usage?.from_used_minor ?? 0;
	const toUsedMinor = usage?.to_used_minor ?? 0;
	if (
		!validateTransactionFlowCreate({
			kind: flow.kind,
			fromTx: { ...fromTx, currency: fromCurrency },
			toTx: { ...toTx, currency: endpointToCurrency },
			amountMinor,
			currency,
			toAmountMinor,
			toCurrency,
			usage: {
				from_used_minor: fromUsedMinor,
				to_used_minor: toUsedMinor,
			},
		})
	) {
		return;
	}
	await db.exec(
		`insert into transaction_flows
			(id, from_transaction_id, to_transaction_id, amount_minor, currency, to_amount_minor, to_currency, kind, created_at, updated_at, _sync_is_deleted, _sync_status, _sync_edited_at)
		values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)`,
		[
			id(),
			flow.from_transaction_id,
			flow.to_transaction_id,
			amountMinor,
			currency,
			toAmountMinor,
			toCurrency,
			flow.kind,
			now,
			now,
			Date.now(),
		],
	);
}

export async function deleteTransactionFlow(
	db: DbHandle,
	flowId: string,
) {
	const now = new Date().toISOString();
	await db.exec(
		`update transaction_flows set
			_sync_is_deleted = 1,
			updated_at = ?,
			_sync_status = 1,
			_sync_edited_at = ?
		where id = ?`,
		[now, Date.now(), flowId],
	);
}

export async function dismissTransactionLinkSuggestion(
	db: DbHandle,
	{
		kind,
		primaryTransactionId,
		candidateIds,
	}: {
		kind: TransactionLinkSuggestionKind;
		primaryTransactionId: string;
		candidateIds: string[];
	},
) {
	if (candidateIds.length === 0) return;
	await db.exec(
		`insert into transaction_link_suggestion_dismissals
		(kind, primary_transaction_id, candidate_signature, created_at)
		values (?, ?, ?, ?)
		on conflict (kind, primary_transaction_id, candidate_signature) do nothing`,
		[kind, primaryTransactionId, sortedCandidateSignature(candidateIds), new Date().toISOString()],
	);
}

export async function bulkSetTransactionCategory(
	db: DbHandle,
	{
		txIds,
		categoryId,
	}: {
		txIds: string[];
		categoryId: string | null;
	},
) {
	if (txIds.length === 0) return;
	await db.withTx(async (txDb) => {
		const now = new Date().toISOString();
		const placeholders = txIds.map(() => "?").join(", ");
		await txDb.exec(
			`update transactions set
				category_id = ?,
				updated_at = ?,
				_sync_status = 1,
				_sync_edited_at = ?
			where id in (${placeholders})`,
			[categoryId, now, Date.now(), ...txIds],
		);
	});
}

export async function bulkDeleteTransactions(
	db: DbHandle,
	txIds: string[],
) {
	const uniqueIds = Array.from(new Set(txIds)).filter(Boolean);
	if (!uniqueIds.length) return;

	await db.withTx(async (txDb) => {
		const now = new Date().toISOString();
		const editedAt = Date.now();
		const placeholders = uniqueIds.map(() => "?").join(", ");
		await txDb.exec(
			`update transactions set
				_sync_is_deleted = 1,
				updated_at = ?,
				_sync_status = 1,
				_sync_edited_at = ?
			where id in (${placeholders})`,
			[now, editedAt, ...uniqueIds],
		);
		await txDb.exec(
			`update transaction_flows set
				_sync_is_deleted = 1,
				updated_at = ?,
				_sync_status = 1,
				_sync_edited_at = ?
			where (from_transaction_id in (${placeholders})
				or to_transaction_id in (${placeholders}))
				and _sync_is_deleted = 0`,
			[now, editedAt, ...uniqueIds, ...uniqueIds],
		);
		await refreshTransactionSearchDocs(txDb, uniqueIds);
	});
}
