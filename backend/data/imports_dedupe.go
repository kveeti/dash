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
        (row_number() over (
            partition by staged.dedup_hash
            order by staged.sequence
        ) - 1)::int as occurrence,
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
decisions as materialized (
    select
        staged.*,
        matched.existing_id is null as is_new,
        matched.existing_id as duplicate_of
    from staged_rows staged
    left join exact_matches matched on matched.staged_id = staged.staged_id
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
),
deleted_staged_rows as (
    delete from import_staged_rows
    where batch_id = $1
)
select
    count(*) filter (where is_new),
    count(*) filter (where not is_new)
from decisions`, batchID).Scan(&added, &duplicates); err != nil {
		return 0, 0, err
	}
	return added, duplicates, nil
}
