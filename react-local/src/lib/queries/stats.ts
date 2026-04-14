import { useQuery } from "@tanstack/react-query";
import { useDb } from "../../providers";
import type { DbHandle } from "../db";

export type StatRow = {
	period: string;
	bucket: string;
	cat_name: string;
	amount: number;
};

const STATS_SQL = `WITH
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
    coalesce(c.name, '__uncategorized__') AS cat_name,
    coalesce(c.is_neutral, 0) AS is_neutral
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t._sync_is_deleted = 0 AND t.id IN (SELECT id FROM relevant_ids)
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
    t.id, t.eff_date, t.cat_name, t.is_neutral,
    t.amount + coalesce((SELECT sum(adj) FROM adjustments a WHERE a.id = t.id), 0) AS amount
  FROM txs t
),
bucketed AS (
  SELECT
    strftime('%Y-%m', eff_date) AS period,
    cat_name,
    CASE
      WHEN is_neutral = 1 THEN 'n'
      WHEN amount > 0     THEN 'i'
      WHEN amount < 0     THEN 'e'
    END AS bucket,
    abs(amount) AS amount
  FROM adjusted
  WHERE amount <> 0
    AND eff_date BETWEEN ? AND ?
)
SELECT period, bucket, cat_name, sum(amount) AS amount
FROM bucketed
GROUP BY period, bucket, cat_name
ORDER BY period, bucket, amount DESC`;

async function getStats(db: DbHandle, from: string, to: string) {
	return db.query<StatRow>(STATS_SQL, [from, to, from, to]);
}

export function useStatsQuery(from: string, to: string) {
	const db = useDb();
	return useQuery({
		queryKey: ["stats", from, to],
		queryFn: () => getStats(db, from, to),
	});
}
