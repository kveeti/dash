package data

import (
	"context"
	"strconv"
	"time"
)

// InboxRow is a pending import row: a transaction-to-be. Categorizing one creates
// the ledger transaction; until then it holds only the parsed bank fields.
type InboxRow struct {
	ID           string
	Date         time.Time
	Amount       int64
	Currency     string
	Counterparty string
	Description  string
}

const InboxPageSize = 100

// ListInbox returns one keyset page of the user's pending import rows across all
// their batches, ordered (date desc, id desc). cursorID == "" starts at the top;
// q filters on counterparty or description.
func (d *Data) ListInbox(ctx context.Context, userID string, cursorDate time.Time, cursorID, q string) ([]InboxRow, error) {
	args := []any{userID}
	cursorClause := ""
	if cursorID != "" {
		cursorClause = "and (r.date, r.id) < ($2::timestamptz, $3::uuid)"
		args = append(args, cursorDate, cursorID)
	}
	searchClause := ""
	if q != "" {
		n := strconv.Itoa(len(args) + 1)
		searchClause = "and (r.raw->>'payee' ilike $" + n + " or r.raw->>'message' ilike $" + n + ")"
		args = append(args, "%"+q+"%")
	}

	rows, err := d.db.QueryContext(ctx,
		`select r.id, r.date, r.amount, r.currency, coalesce(r.raw->>'payee', ''), coalesce(r.raw->>'message', '')
		 from import_rows r
		 join import_batches b on b.id = r.batch_id
		 where b.user_id = $1 and r.status = 'pending' `+cursorClause+` `+searchClause+`
		 order by r.date desc, r.id desc
		 limit `+strconv.Itoa(InboxPageSize), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []InboxRow
	for rows.Next() {
		var r InboxRow
		if err := rows.Scan(&r.ID, &r.Date, &r.Amount, &r.Currency, &r.Counterparty, &r.Description); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// categorizeInboxSQL creates one balanced transaction per pending row in a single
// set-based statement: an asset leg on the row's import bucket + a category leg on
// the chosen bucket, and flips each row to 'categorized' pointing at its new
// transaction. Inserts are audited (null before) and each row's before-image is
// captured for the status flip. Params: $1 user, $2 row ids, $3 category bucket.
const categorizeInboxSQL = `
with rows as materialized (
    select r.id as row_id, r.date, r.amount, r.currency,
           coalesce(r.raw->>'payee', '') as payee, coalesce(r.raw->>'message', '') as message, b.bucket_id,
           uuidv7() as txn_id, uuidv7() as p1, uuidv7() as p2
    from import_rows r
    join import_batches b on b.id = r.batch_id
    where r.id = any($2::uuid[]) and b.user_id = $1 and r.status = 'pending'
),
ins_txn as (
    insert into transactions (id, owner_user_id, date, counterparty, description, created_at)
    select txn_id, $1, date, payee, message, now() from rows
),
ins_post as (
    insert into postings (id, transaction_id, bucket_id, amount, currency, mirror_id, created_at)
    select p1, txn_id, bucket_id, amount, currency, null::uuid, now() from rows
    union all
    select p2, txn_id, $3, -amount, currency, null::uuid, now() from rows
),
aud_txn as (
    insert into audit_logs (id, actor_user_id, table_name, row_id, operation, before, created_at)
    select uuidv7(), $1, 'transactions', txn_id, 'insert', null::jsonb, now() from rows
),
aud_post as (
    insert into audit_logs (id, actor_user_id, table_name, row_id, operation, before, created_at)
    select uuidv7(), $1, 'postings', p1, 'insert', null::jsonb, now() from rows
    union all
    select uuidv7(), $1, 'postings', p2, 'insert', null::jsonb, now() from rows
),
aud_rows as (
    insert into audit_logs (id, actor_user_id, table_name, row_id, operation, before, created_at)
    select uuidv7(), $1, 'import_rows', orig.id, 'update', to_jsonb(orig), now()
    from import_rows orig where orig.id in (select row_id from rows)
),
upd as (
    update import_rows set status = 'categorized', transaction_id = r.txn_id
    from rows r where import_rows.id = r.row_id
)
select count(*) from rows`

// CategorizeInboxRows turns each pending row into a ledger transaction under one
// category bucket. Rows not owned or not pending are silently skipped. Returns the
// number of rows categorized.
func (d *Data) CategorizeInboxRows(ctx context.Context, userID string, rowIDs []string, bucketID string) (int, error) {
	if len(rowIDs) == 0 {
		return 0, nil
	}
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var valid bool
	if err := tx.QueryRowContext(ctx,
		"select exists(select 1 from buckets where id = $1 and owner_user_id = $2 and kind in ('expense', 'income') and hidden = false)",
		bucketID, userID).Scan(&valid); err != nil {
		return 0, err
	}
	if !valid {
		return 0, ErrInvalidCategory
	}

	var n int
	if err := tx.QueryRowContext(ctx, categorizeInboxSQL, userID, rowIDs, bucketID).Scan(&n); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return n, nil
}
