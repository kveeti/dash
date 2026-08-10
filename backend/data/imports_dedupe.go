package data

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const dateLayout = "2006-01-02"

func dedupHash(bucketID string, occurredOn time.Time, amount int64, currency, counterparty string) string {
	fingerprint := strings.Join([]string{
		bucketID,
		occurredOn.Format(dateLayout),
		strconv.FormatInt(amount, 10),
		currency,
		strings.ToLower(strings.Join(strings.Fields(counterparty), " ")),
	}, "\x00")
	sum := sha256.Sum256([]byte(fingerprint))
	return hex.EncodeToString(sum[:])
}

// finalizeStagedRows assigns occurrence numbers, dedupes the complete batch,
// and removes its staging rows.
func finalizeStagedRows(ctx context.Context, tx pgx.Tx, batchID string) (int, int, error) {
	if _, err := tx.Exec(ctx, `
update import_staged_rows staged
set occurrence = numbered.occurrence
from (
    select
        id,
        row_number() over (partition by dedup_hash order by sequence) - 1 as occurrence
    from import_staged_rows
    where batch_id = $1
      and dedup_hash in (
          select dedup_hash
          from import_staged_rows
          where batch_id = $1
          group by dedup_hash
          having count(*) > 1
      )
) numbered
where staged.id = numbered.id
  and numbered.occurrence > 0`, batchID); err != nil {
		return 0, 0, err
	}

	var added, duplicates int
	if err := tx.QueryRow(ctx, `
with staged_rows as materialized (
    select
        staged.id as staged_id,
        staged.occurred_on,
        staged.occurred_at,
        staged.amount,
        staged.currency,
        staged.counterparty,
        staged.note,
        staged.dedup_hash,
        staged.occurrence,
        uuidv7() as import_row_id
    from import_staged_rows staged
    where staged.batch_id = $1
),
exact_matches as materialized (
    select staged.staged_id, existing.id as existing_id
    from staged_rows staged
    join import_rows existing
      on existing.dedup_hash = staged.dedup_hash
     and existing.occurrence = staged.occurrence
     and existing.status <> 'duplicate'
),
unmatched_staged_rows as materialized (
    select
        staged.*,
        lower(btrim(staged.counterparty)) as normalized_counterparty
    from staged_rows staged
    where not exists (
        select 1
        from exact_matches matched
        where matched.staged_id = staged.staged_id
    )
),
ranked_staged_rows as materialized (
    select
        staged.*,
        row_number() over (
            partition by amount, currency, normalized_counterparty
            order by occurred_on, staged_id
        ) as match_number,
        min(occurred_on) over (
            partition by amount, currency, normalized_counterparty
        ) as first_date,
        max(occurred_on) over (
            partition by amount, currency, normalized_counterparty
        ) as last_date
    from unmatched_staged_rows staged
),
match_bounds as materialized (
    select
        amount,
        currency,
        normalized_counterparty,
        min(first_date) as first_date,
        max(last_date) as last_date
    from ranked_staged_rows
    group by amount, currency, normalized_counterparty
),
ranked_existing_rows as materialized (
    select
        existing.id,
        existing.occurred_on,
        existing.amount,
        existing.currency,
        lower(btrim(existing.counterparty)) as normalized_counterparty,
        row_number() over (
            partition by existing.amount, existing.currency, lower(btrim(existing.counterparty))
            order by existing.occurred_on, existing.id
        ) as match_number
    from import_rows existing
    join import_batches existing_batch on existing_batch.id = existing.batch_id
    join import_batches current_batch
      on current_batch.id = $1
     and current_batch.bucket_id = existing_batch.bucket_id
     and current_batch.source <> existing_batch.source
    join match_bounds bounds
      on bounds.amount = existing.amount
     and bounds.currency = existing.currency
     and bounds.normalized_counterparty = lower(btrim(existing.counterparty))
     and existing.occurred_on between bounds.first_date - 1 and bounds.last_date + 1
    where existing.status <> 'duplicate'
      and not exists (
          select 1
          from exact_matches matched
          where matched.existing_id = existing.id
      )
),
adjacent_date_matches as (
    select staged.staged_id, existing.id as existing_id
    from ranked_staged_rows staged
    join ranked_existing_rows existing
      using (amount, currency, normalized_counterparty, match_number)
    where abs(staged.occurred_on - existing.occurred_on) <= 1
),
all_matches as (
    select * from exact_matches
    union all
    select * from adjacent_date_matches
),
decisions as materialized (
    select
        staged.*,
        matched.existing_id is null as is_new,
        matched.existing_id as duplicate_of
    from staged_rows staged
    left join all_matches matched on matched.staged_id = staged.staged_id
),
inserted_pending_rows as (
    insert into import_rows (
        id, batch_id, occurred_on, occurred_at, amount, currency,
        counterparty, note, dedup_hash, occurrence, status
    )
    select
        import_row_id, $1, occurred_on, occurred_at, amount, currency,
        counterparty, note, dedup_hash, occurrence, 'pending'
    from decisions
    where is_new
),
inserted_duplicate_rows as (
    insert into import_rows (
        id, batch_id, occurred_on, occurred_at, amount, currency,
        counterparty, note, dedup_hash, occurrence, status, duplicate_of
    )
    select
        import_row_id, $1, occurred_on, occurred_at, amount, currency,
        counterparty, note, dedup_hash, occurrence, 'duplicate', duplicate_of
    from decisions
    where not is_new
)
select
    count(*) filter (where is_new),
    count(*) filter (where not is_new)
from decisions`, batchID).Scan(&added, &duplicates); err != nil {
		return 0, 0, err
	}
	if _, err := tx.Exec(ctx, `delete from import_staged_rows where batch_id = $1`, batchID); err != nil {
		return 0, 0, err
	}
	return added, duplicates, nil
}
