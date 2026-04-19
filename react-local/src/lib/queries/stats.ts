import { useQuery } from "@tanstack/react-query";
import { useDb } from "../../providers";
import { normalizeCurrency } from "../currency";
import type { DbHandle } from "../db";
import { FX_ANCHOR_CURRENCY, type ConversionMode } from "./settings";

export type StatRow = {
	period: string;
	bucket: string;
	cat_name: string;
	currency: string;
	amount: number;
	original_amount: number;
	tx_count: number;
	unconverted_count: number;
};

type MissingRateCurrency = {
	currency: string;
	count: number;
	amount: number;
};

export type ConvertedStatsSummary = {
	reporting_currency: string;
	anchor_currency: string;
	mode: ConversionMode;
	max_staleness_days: number;
	total_count: number;
	converted_count: number;
	total_source_amount: number;
	converted_source_amount: number;
	unconverted_source_amount: number;
	converted_total: number;
	coverage_count_ratio: number;
	coverage_amount_ratio: number;
	missing_by_currency: MissingRateCurrency[];
};

export type ConvertedStatTransactionRow = {
	id: string;
	eff_date: string;
	period: string;
	bucket: string;
	cat_name: string;
	original_currency: string;
	original_signed_amount: number;
	original_amount: number;
	currency: string;
	converted_signed_amount: number | null;
	converted_amount: number | null;
};

const STATS_BASE_CTE = `WITH
in_window AS (
  SELECT id FROM transactions
  WHERE _sync_is_deleted = 0
    AND coalesce(categorize_on, date) BETWEEN ? AND ?
),
relevant_ids AS (
  SELECT id FROM in_window
  UNION
  SELECT CASE WHEN l.transaction_a_id = w.id
              THEN l.transaction_b_id
              ELSE l.transaction_a_id END
  FROM transaction_links l
  JOIN in_window w ON w.id IN (l.transaction_a_id, l.transaction_b_id)
  WHERE l._sync_is_deleted = 0
),
txs AS (
  SELECT
    t.id,
    coalesce(t.categorize_on, t.date) AS eff_date,
    t.amount,
    t.currency,
    coalesce(c.name, '__uncategorized__') AS cat_name,
    coalesce(c.is_neutral, 0) AS is_neutral
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t._sync_is_deleted = 0
    AND t.id IN (SELECT id FROM relevant_ids)
    AND (? IS NULL OR upper(t.currency) = upper(?))
),
pairs AS (
  SELECT
    p.id AS pos_id, p.amount AS pos_amount, p.eff_date AS pos_date,
    n.id AS neg_id, n.amount AS neg_amount
  FROM txs p
  JOIN transaction_links l
    ON p.id IN (l.transaction_a_id, l.transaction_b_id)
  JOIN txs n
    ON n.id = CASE WHEN l.transaction_a_id = p.id
                   THEN l.transaction_b_id
                   ELSE l.transaction_a_id END
  WHERE p.amount > 0 AND n.amount < 0 AND p.is_neutral = 0
    AND upper(p.currency) = upper(n.currency)
    AND l._sync_is_deleted = 0
),
allocations AS (
  SELECT
    pos_id, neg_id,
    max(0.0, min(
      pos_amount,
      abs(neg_amount) - coalesce(sum(pos_amount) OVER (
        PARTITION BY neg_id
        ORDER BY pos_date, pos_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0)
    )) AS consumed
  FROM pairs
),
adjustments AS (
  SELECT pos_id AS id, -sum(consumed) AS adj FROM allocations GROUP BY pos_id
  UNION ALL
  SELECT neg_id AS id,  sum(consumed) AS adj FROM allocations GROUP BY neg_id
),
adjusted AS (
  SELECT
    t.id, t.eff_date, t.currency, t.cat_name, t.is_neutral,
    t.amount + coalesce((SELECT sum(adj) FROM adjustments a WHERE a.id = t.id), 0) AS amount
  FROM txs t
)`;

function buildConvertedCteSql(mode: ConversionMode) {
	const strictRateFloor =
		mode === "strict"
			? "and r.rate_date >= date(n.eff_date, '-' || ? || ' days')"
			: "";

	return `${STATS_BASE_CTE},
normalized AS (
  SELECT
    id,
    eff_date,
    strftime('%Y-%m', eff_date) AS period,
    upper(currency) AS original_currency,
    cat_name,
    CASE
      WHEN is_neutral = 1 THEN 'n'
      WHEN amount > 0     THEN 'i'
      WHEN amount < 0     THEN 'e'
    END AS bucket,
    amount AS original_signed_amount,
    abs(amount) AS original_amount
  FROM adjusted
  WHERE amount <> 0
    AND eff_date BETWEEN ? AND ?
),
with_rates AS (
  SELECT
    n.*,
    CASE
      WHEN n.original_currency = upper(?) THEN 1.0
      ELSE (
        SELECT r.rate_to_anchor
        FROM fx_rates r
        WHERE upper(r.currency) = n.original_currency
          AND r.rate_date <= n.eff_date
          ${strictRateFloor}
        ORDER BY r.rate_date DESC
        LIMIT 1
      )
    END AS tx_rate_to_anchor,
    CASE
      WHEN upper(?) = upper(?) THEN 1.0
      ELSE (
        SELECT r.rate_to_anchor
        FROM fx_rates r
        WHERE upper(r.currency) = upper(?)
          AND r.rate_date <= n.eff_date
          ${strictRateFloor}
        ORDER BY r.rate_date DESC
        LIMIT 1
      )
    END AS reporting_rate_to_anchor
  FROM normalized n
),
converted AS (
  SELECT
    n.id,
    n.eff_date,
    n.period,
    n.bucket,
    n.cat_name,
    n.original_currency,
    n.original_signed_amount,
    n.original_amount,
    CASE
      WHEN n.original_currency = upper(?) THEN n.original_signed_amount
      WHEN n.tx_rate_to_anchor IS NULL OR n.reporting_rate_to_anchor IS NULL OR n.reporting_rate_to_anchor = 0 THEN NULL
      ELSE n.original_signed_amount * n.tx_rate_to_anchor / n.reporting_rate_to_anchor
    END AS converted_signed_amount
  FROM with_rates n
)`;
}

function buildConvertedParams(input: {
	from: string;
	to: string;
	sourceCurrency?: string;
	reportingCurrency: string;
	maxStalenessDays: number;
	mode: ConversionMode;
	anchorCurrency: string;
}) {
	const sourceCurrency = input.sourceCurrency?.trim()
		? normalizeCurrency(input.sourceCurrency)
		: null;

	const base: Array<string | number | null> = [
		input.from,
		input.to,
		sourceCurrency,
		sourceCurrency,
		input.from,
		input.to,
		input.anchorCurrency,
	];

	if (input.mode === "strict") {
		base.push(Math.max(0, input.maxStalenessDays));
	}

	base.push(
		input.reportingCurrency,
		input.anchorCurrency,
		input.reportingCurrency,
	);

	if (input.mode === "strict") {
		base.push(Math.max(0, input.maxStalenessDays));
	}

	base.push(input.reportingCurrency);
	return base;
}

async function getStats(input: {
	db: DbHandle;
	from: string;
	to: string;
	sourceCurrency?: string;
	reportingCurrency: string;
	maxStalenessDays: number;
	mode: ConversionMode;
}): Promise<StatRow[]> {
	const anchorCurrency = FX_ANCHOR_CURRENCY;
	const cteSql = buildConvertedCteSql(input.mode);
	const sql = `${cteSql}
select
	period,
	bucket,
	cat_name,
	upper(?) as currency,
	sum(case when converted_signed_amount is null then 0 else abs(converted_signed_amount) end) as amount,
	sum(original_amount) as original_amount,
	count(*) as tx_count,
	sum(case when converted_signed_amount is null then 1 else 0 end) as unconverted_count
from converted
group by period, bucket, cat_name
order by period, bucket, amount desc`;

	const params = buildConvertedParams({
		from: input.from,
		to: input.to,
		sourceCurrency: input.sourceCurrency,
		reportingCurrency: input.reportingCurrency,
		maxStalenessDays: input.maxStalenessDays,
		mode: input.mode,
		anchorCurrency,
	});
	params.push(input.reportingCurrency);

	return input.db.query<StatRow>(sql, params);
}

async function getConvertedStatsSummary(input: {
	db: DbHandle;
	from: string;
	to: string;
	sourceCurrency?: string;
	reportingCurrency: string;
	maxStalenessDays: number;
	mode: ConversionMode;
}): Promise<ConvertedStatsSummary> {
	const anchorCurrency = FX_ANCHOR_CURRENCY;
	const cteSql = buildConvertedCteSql(input.mode);

	const summarySql = `${cteSql}
select
	upper(?) as reporting_currency,
	upper(?) as anchor_currency,
	? as mode,
	? as max_staleness_days,
	count(*) as total_count,
	sum(case when converted_signed_amount is not null then 1 else 0 end) as converted_count,
	sum(original_amount) as total_source_amount,
	sum(case when converted_signed_amount is not null then original_amount else 0 end) as converted_source_amount,
	sum(case when converted_signed_amount is not null then abs(converted_signed_amount) else 0 end) as converted_total
from converted`;

	const summaryParams = buildConvertedParams({
		from: input.from,
		to: input.to,
		sourceCurrency: input.sourceCurrency,
		reportingCurrency: input.reportingCurrency,
		maxStalenessDays: input.maxStalenessDays,
		mode: input.mode,
		anchorCurrency,
	});
	summaryParams.push(
		input.reportingCurrency,
		anchorCurrency,
		input.mode,
		Math.max(0, input.maxStalenessDays),
	);

	const summaryRows = await input.db.query<ConvertedStatsSummary>(summarySql, summaryParams);
	const summary = summaryRows[0] ?? {
		reporting_currency: input.reportingCurrency,
		anchor_currency: anchorCurrency,
		mode: input.mode,
		max_staleness_days: Math.max(0, input.maxStalenessDays),
		total_count: 0,
		converted_count: 0,
		total_source_amount: 0,
		converted_source_amount: 0,
		unconverted_source_amount: 0,
		converted_total: 0,
		coverage_count_ratio: 1,
		coverage_amount_ratio: 1,
		missing_by_currency: [],
	};

	const missingSql = `${cteSql}
select
	original_currency as currency,
	count(*) as count,
	sum(original_amount) as amount
from converted
where converted_signed_amount is null
group by original_currency
order by amount desc`;
	const missingParams = buildConvertedParams({
		from: input.from,
		to: input.to,
		sourceCurrency: input.sourceCurrency,
		reportingCurrency: input.reportingCurrency,
		maxStalenessDays: input.maxStalenessDays,
		mode: input.mode,
		anchorCurrency,
	});
	const missingByCurrency = await input.db.query<MissingRateCurrency>(missingSql, missingParams);

	const totalCount = Number(summary.total_count || 0);
	const convertedCount = Number(summary.converted_count || 0);
	const totalSourceAmount = Number(summary.total_source_amount || 0);
	const convertedSourceAmount = Number(summary.converted_source_amount || 0);
	const convertedTotal = Number(summary.converted_total || 0);

	return {
		reporting_currency: normalizeCurrency(summary.reporting_currency),
		anchor_currency: normalizeCurrency(summary.anchor_currency),
		mode: input.mode,
		max_staleness_days: Math.max(0, input.maxStalenessDays),
		total_count: totalCount,
		converted_count: convertedCount,
		total_source_amount: totalSourceAmount,
		converted_source_amount: convertedSourceAmount,
		unconverted_source_amount: totalSourceAmount - convertedSourceAmount,
		converted_total: convertedTotal,
		coverage_count_ratio: totalCount > 0 ? convertedCount / totalCount : 1,
		coverage_amount_ratio:
			totalSourceAmount > 0 ? convertedSourceAmount / totalSourceAmount : 1,
		missing_by_currency: missingByCurrency.map((row) => ({
			currency: normalizeCurrency(row.currency),
			count: Number(row.count || 0),
			amount: Number(row.amount || 0),
		})),
	};
}

async function getConvertedStatTransactions(input: {
	db: DbHandle;
	from: string;
	to: string;
	sourceCurrency?: string;
	reportingCurrency: string;
	maxStalenessDays: number;
	mode: ConversionMode;
}): Promise<ConvertedStatTransactionRow[]> {
	const anchorCurrency = FX_ANCHOR_CURRENCY;
	const cteSql = buildConvertedCteSql(input.mode);
	const sql = `${cteSql}
select
	id,
	eff_date,
	period,
	bucket,
	cat_name,
	original_currency,
	original_signed_amount,
	original_amount,
	upper(?) as currency,
	converted_signed_amount,
	case
		when converted_signed_amount is null then null
		else abs(converted_signed_amount)
	end as converted_amount
from converted
order by eff_date desc, id desc`;

	const params = buildConvertedParams({
		from: input.from,
		to: input.to,
		sourceCurrency: input.sourceCurrency,
		reportingCurrency: input.reportingCurrency,
		maxStalenessDays: input.maxStalenessDays,
		mode: input.mode,
		anchorCurrency,
	});
	params.push(input.reportingCurrency);

	return input.db.query<ConvertedStatTransactionRow>(sql, params);
}

export function useStatsQuery(input: {
	from: string;
	to: string;
	sourceCurrency?: string;
	reportingCurrency?: string;
	maxStalenessDays?: number;
	mode?: ConversionMode;
}) {
	const db = useDb();
	const reportingCurrency = input.reportingCurrency
		? normalizeCurrency(input.reportingCurrency)
		: undefined;
	const mode: ConversionMode = input.mode === "lenient" ? "lenient" : "strict";
	const maxStalenessDays = Math.max(0, Math.trunc(input.maxStalenessDays ?? 7));

	return useQuery({
		queryKey: [
			"stats",
			"converted-by-month",
			input.from,
			input.to,
			input.sourceCurrency ?? "",
			reportingCurrency ?? "",
			maxStalenessDays,
			mode,
		],
		enabled: !!reportingCurrency,
		queryFn: () =>
			getStats({
				db,
				from: input.from,
				to: input.to,
				sourceCurrency: input.sourceCurrency,
				reportingCurrency: reportingCurrency!,
				maxStalenessDays,
				mode,
			}),
	});
}

export function useConvertedStatsSummaryQuery(input: {
	from: string;
	to: string;
	sourceCurrency?: string;
	reportingCurrency?: string;
	maxStalenessDays?: number;
	mode?: ConversionMode;
}) {
	const db = useDb();
	const reportingCurrency = input.reportingCurrency
		? normalizeCurrency(input.reportingCurrency)
		: undefined;
	const mode: ConversionMode = input.mode === "lenient" ? "lenient" : "strict";
	const maxStalenessDays = Math.max(0, Math.trunc(input.maxStalenessDays ?? 7));

	return useQuery({
		queryKey: [
			"stats",
			"converted-summary",
			input.from,
			input.to,
			input.sourceCurrency ?? "",
			reportingCurrency ?? "",
			maxStalenessDays,
			mode,
		],
		enabled: !!reportingCurrency,
		queryFn: () =>
			getConvertedStatsSummary({
				db,
				from: input.from,
				to: input.to,
				sourceCurrency: input.sourceCurrency,
				reportingCurrency: reportingCurrency!,
				maxStalenessDays,
				mode,
			}),
	});
}

export function useConvertedStatTransactionsQuery(input: {
	from: string;
	to: string;
	sourceCurrency?: string;
	reportingCurrency?: string;
	maxStalenessDays?: number;
	mode?: ConversionMode;
}) {
	const db = useDb();
	const reportingCurrency = input.reportingCurrency
		? normalizeCurrency(input.reportingCurrency)
		: undefined;
	const mode: ConversionMode = input.mode === "lenient" ? "lenient" : "strict";
	const maxStalenessDays = Math.max(0, Math.trunc(input.maxStalenessDays ?? 7));

	return useQuery({
		queryKey: [
			"stats",
			"converted-transactions",
			input.from,
			input.to,
			input.sourceCurrency ?? "",
			reportingCurrency ?? "",
			maxStalenessDays,
			mode,
		],
		enabled: !!reportingCurrency,
		queryFn: () =>
			getConvertedStatTransactions({
				db,
				from: input.from,
				to: input.to,
				sourceCurrency: input.sourceCurrency,
				reportingCurrency: reportingCurrency!,
				maxStalenessDays,
				mode,
			}),
	});
}
