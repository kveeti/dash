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
	bucket: string;
	cat_name: string;
	counter_party: string;
	original_currency: string;
	original_amount: number;
	converted_amount: number | null;
};

function buildStatsBaseCteSql(includeSourceCurrencyFilter: boolean) {
	const sourceCurrencyPredicate = includeSourceCurrencyFilter
		? "    AND t.currency = ?\n"
		: "";

	return `WITH
in_window AS (
  SELECT id FROM transactions
  WHERE _sync_is_deleted = 0
    AND coalesce(categorize_on, date) BETWEEN ? AND ?
),
relevant_ids AS (
  SELECT id FROM in_window
  UNION
  SELECT l.transaction_b_id
  FROM in_window w
  JOIN transaction_links l
    ON l.transaction_a_id = w.id
  WHERE l._sync_is_deleted = 0
  UNION
  SELECT l.transaction_a_id
  FROM in_window w
  JOIN transaction_links l
    ON l.transaction_b_id = w.id
  WHERE l._sync_is_deleted = 0
),
txs AS (
  SELECT
    t.id,
    coalesce(t.categorize_on, t.date) AS eff_date,
    t.amount,
    t.currency,
    t.counter_party,
    coalesce(c.name, '__uncategorized__') AS cat_name,
    coalesce(c.is_neutral, 0) AS is_neutral
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t._sync_is_deleted = 0
    AND t.id IN (SELECT id FROM relevant_ids)
${sourceCurrencyPredicate}),
pairs AS (
  SELECT
    p.id AS pos_id, p.amount AS pos_amount, p.eff_date AS pos_date,
    n.id AS neg_id, n.amount AS neg_amount
  FROM txs p
  JOIN transaction_links l
    ON l.transaction_a_id = p.id
  JOIN txs n
    ON n.id = l.transaction_b_id
  WHERE p.amount > 0 AND n.amount < 0 AND p.is_neutral = 0
    AND p.currency = n.currency
    AND l._sync_is_deleted = 0
  UNION ALL
  SELECT
    p.id AS pos_id, p.amount AS pos_amount, p.eff_date AS pos_date,
    n.id AS neg_id, n.amount AS neg_amount
  FROM txs p
  JOIN transaction_links l
    ON l.transaction_b_id = p.id
  JOIN txs n
    ON n.id = l.transaction_a_id
  WHERE p.amount > 0 AND n.amount < 0 AND p.is_neutral = 0
    AND p.currency = n.currency
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
adjustments_raw AS (
  SELECT pos_id AS id, -sum(consumed) AS adj FROM allocations GROUP BY pos_id
  UNION ALL
  SELECT neg_id AS id,  sum(consumed) AS adj FROM allocations GROUP BY neg_id
),
adjustments AS (
  SELECT id, sum(adj) AS adj
  FROM adjustments_raw
  GROUP BY id
),
adjusted AS (
  SELECT
    t.id, t.eff_date, t.currency, t.cat_name, t.is_neutral, t.counter_party,
    t.amount + coalesce(a.adj, 0) AS amount
  FROM txs t
  LEFT JOIN adjustments a
    ON a.id = t.id
)`;
}

function buildConvertedCteSql(mode: ConversionMode, includeSourceCurrencyFilter: boolean) {
	const strictTxRateFloor =
		mode === "strict"
			? "and r.rate_date >= date(p.eff_date, '-' || ? || ' days')"
			: "";
	const strictReportingRateFloor =
		mode === "strict"
			? "and r.rate_date >= date(d.eff_date, '-' || ? || ' days')"
			: "";

	return `${buildStatsBaseCteSql(includeSourceCurrencyFilter)},
normalized AS (
  SELECT
    id,
    eff_date,
    strftime('%Y-%m', eff_date) AS period,
    upper(currency) AS original_currency,
    cat_name,
    counter_party,
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
distinct_pairs AS (
  SELECT DISTINCT original_currency, eff_date
  FROM normalized
),
tx_rates AS (
  SELECT
    p.original_currency,
    p.eff_date,
    CASE
      WHEN p.original_currency = ? THEN 1.0
      ELSE (
        SELECT r.rate_to_anchor
        FROM fx_rates r
        WHERE r.currency = p.original_currency
          AND r.rate_date <= p.eff_date
          ${strictTxRateFloor}
        ORDER BY r.rate_date DESC
        LIMIT 1
      )
    END AS tx_rate_to_anchor
  FROM distinct_pairs p
),
distinct_dates AS (
  SELECT DISTINCT eff_date
  FROM normalized
),
reporting_rates AS (
  SELECT
    d.eff_date,
    CASE
      WHEN ? = ? THEN 1.0
      ELSE (
        SELECT r.rate_to_anchor
        FROM fx_rates r
        WHERE r.currency = ?
          AND r.rate_date <= d.eff_date
          ${strictReportingRateFloor}
        ORDER BY r.rate_date DESC
        LIMIT 1
      )
    END AS reporting_rate_to_anchor
  FROM distinct_dates d
),
with_rates AS (
  SELECT
    n.*,
    tx.tx_rate_to_anchor,
    rr.reporting_rate_to_anchor
  FROM normalized n
  LEFT JOIN tx_rates tx
    ON tx.original_currency = n.original_currency
   AND tx.eff_date = n.eff_date
  LEFT JOIN reporting_rates rr
    ON rr.eff_date = n.eff_date
),
converted AS (
  SELECT
    n.id,
    n.eff_date,
    n.period,
    n.bucket,
    n.cat_name,
    n.counter_party,
    n.original_currency,
    n.original_signed_amount,
    n.original_amount,
    CASE
      WHEN n.original_currency = ? THEN n.original_signed_amount
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
	const reportingCurrency = normalizeCurrency(input.reportingCurrency);
	const anchorCurrency = normalizeCurrency(input.anchorCurrency);

	const base: Array<string | number> = [
		input.from,
		input.to,
	];

	if (sourceCurrency) {
		base.push(sourceCurrency);
	}

	base.push(
		input.from,
		input.to,
		anchorCurrency,
	);

	if (input.mode === "strict") {
		base.push(Math.max(0, input.maxStalenessDays));
	}

	base.push(
		reportingCurrency,
		anchorCurrency,
		reportingCurrency,
	);

	if (input.mode === "strict") {
		base.push(Math.max(0, input.maxStalenessDays));
	}

	base.push(reportingCurrency);
	return {
		params: base,
		includeSourceCurrencyFilter: !!sourceCurrency,
	};
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
	const convertedParams = buildConvertedParams({
		from: input.from,
		to: input.to,
		sourceCurrency: input.sourceCurrency,
		reportingCurrency: input.reportingCurrency,
		maxStalenessDays: input.maxStalenessDays,
		mode: input.mode,
		anchorCurrency,
	});
	const cteSql = buildConvertedCteSql(input.mode, convertedParams.includeSourceCurrencyFilter);
	const sql = `${cteSql}
select
	period,
	bucket,
	cat_name,
	? as currency,
	sum(case when converted_signed_amount is null then 0 else abs(converted_signed_amount) end) as amount,
	sum(original_amount) as original_amount,
	count(*) as tx_count,
	sum(case when converted_signed_amount is null then 1 else 0 end) as unconverted_count
from converted
group by period, bucket, cat_name
order by period, bucket, amount desc`;

	const params = [...convertedParams.params];
	params.push(normalizeCurrency(input.reportingCurrency));

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
	const convertedParams = buildConvertedParams({
		from: input.from,
		to: input.to,
		sourceCurrency: input.sourceCurrency,
		reportingCurrency: input.reportingCurrency,
		maxStalenessDays: input.maxStalenessDays,
		mode: input.mode,
		anchorCurrency,
	});
	const cteSql = buildConvertedCteSql(input.mode, convertedParams.includeSourceCurrencyFilter);

	const summarySql = `${cteSql}
select
	? as reporting_currency,
	? as anchor_currency,
	? as mode,
	? as max_staleness_days,
	count(*) as total_count,
	sum(case when converted_signed_amount is not null then 1 else 0 end) as converted_count,
	sum(original_amount) as total_source_amount,
	sum(case when converted_signed_amount is not null then original_amount else 0 end) as converted_source_amount,
	sum(case when converted_signed_amount is not null then abs(converted_signed_amount) else 0 end) as converted_total
from converted`;

	const summaryParams = [...convertedParams.params];
	summaryParams.push(
		normalizeCurrency(input.reportingCurrency),
		normalizeCurrency(anchorCurrency),
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
	const missingParams = [...convertedParams.params];
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
	perCategoryLimit?: number;
}): Promise<ConvertedStatTransactionRow[]> {
	const anchorCurrency = FX_ANCHOR_CURRENCY;
	const convertedParams = buildConvertedParams({
		from: input.from,
		to: input.to,
		sourceCurrency: input.sourceCurrency,
		reportingCurrency: input.reportingCurrency,
		maxStalenessDays: input.maxStalenessDays,
		mode: input.mode,
		anchorCurrency,
	});
	const cteSql = buildConvertedCteSql(input.mode, convertedParams.includeSourceCurrencyFilter);
	const perCategoryLimit = input.perCategoryLimit
		? Math.max(1, Math.trunc(input.perCategoryLimit))
		: null;

	const sql = perCategoryLimit == null
		? `${cteSql}
	select
		id,
		bucket,
		cat_name,
		counter_party,
		original_currency,
		original_amount,
		case
			when converted_signed_amount is null then null
			else abs(converted_signed_amount)
		end as converted_amount
	from converted
	order by eff_date desc, id desc`
		: `${cteSql}
	, ranked AS (
		select
			id,
			eff_date,
			period,
			bucket,
			cat_name,
			counter_party,
			original_currency,
			original_amount,
			case
				when converted_signed_amount is null then null
				else abs(converted_signed_amount)
			end as converted_amount,
			row_number() over (
				partition by period, bucket, cat_name
				order by eff_date desc, id desc
			) as preview_rank
		from converted
	)
	select
		id,
		bucket,
		cat_name,
		counter_party,
		original_currency,
		original_amount,
		converted_amount
	from ranked
	where preview_rank <= ?
	order by eff_date desc, id desc`;

	const params = [...convertedParams.params];
	if (perCategoryLimit != null) {
		params.push(perCategoryLimit);
	}

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
	enabled?: boolean;
	perCategoryLimit?: number;
}) {
	const db = useDb();
	const reportingCurrency = input.reportingCurrency
		? normalizeCurrency(input.reportingCurrency)
		: undefined;
	const mode: ConversionMode = input.mode === "lenient" ? "lenient" : "strict";
	const maxStalenessDays = Math.max(0, Math.trunc(input.maxStalenessDays ?? 7));
	const perCategoryLimit =
		input.perCategoryLimit == null
			? undefined
			: Math.max(1, Math.trunc(input.perCategoryLimit));

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
			perCategoryLimit ?? "",
		],
		enabled: !!reportingCurrency && (input.enabled ?? true),
		queryFn: () =>
			getConvertedStatTransactions({
				db,
				from: input.from,
				to: input.to,
				sourceCurrency: input.sourceCurrency,
				reportingCurrency: reportingCurrency!,
				maxStalenessDays,
				mode,
				perCategoryLimit,
			}),
	});
}
