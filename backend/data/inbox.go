package data

import (
	"context"
	"database/sql"
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
	BucketID     string
	Account      string
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
		`select r.id, r.date, r.amount, r.currency, coalesce(r.raw->>'payee', ''), coalesce(r.raw->>'message', ''), b.bucket_id, bucket.name
		 from import_rows r
		 join import_batches b on b.id = r.batch_id
		 join buckets bucket on bucket.id = b.bucket_id
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
		if err := rows.Scan(&r.ID, &r.Date, &r.Amount, &r.Currency, &r.Counterparty, &r.Description, &r.BucketID, &r.Account); err != nil {
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
func (d *Data) GetTransferMatches(ctx context.Context, userID, rowID, q string) (InboxRow, []InboxRow, error) {
	var source InboxRow
	err := d.db.QueryRowContext(ctx, `select r.id, r.date, r.amount, r.currency,
		coalesce(r.raw->>'payee', ''), coalesce(r.raw->>'message', ''), b.bucket_id, bucket.name
		from import_rows r join import_batches b on b.id = r.batch_id join buckets bucket on bucket.id = b.bucket_id
		where r.id = $1 and b.user_id = $2 and r.status = 'pending'`, rowID, userID).
		Scan(&source.ID, &source.Date, &source.Amount, &source.Currency, &source.Counterparty, &source.Description, &source.BucketID, &source.Account)
	if err == sql.ErrNoRows {
		return source, nil, ErrNotFound
	}
	if err != nil {
		return source, nil, err
	}

	rows, err := d.db.QueryContext(ctx, `select r.id, r.date, r.amount, r.currency,
		coalesce(r.raw->>'payee', ''), coalesce(r.raw->>'message', ''), b.bucket_id, bucket.name
		from import_rows r join import_batches b on b.id = r.batch_id join buckets bucket on bucket.id = b.bucket_id
		where b.user_id = $1 and r.status = 'pending' and r.id <> $2 and b.bucket_id <> $3
		and r.currency = $4 and r.amount = $5 and r.date between $6::timestamptz - interval '7 days' and $6::timestamptz + interval '7 days'
		and ($7 = '' or coalesce(r.raw->>'payee', '') ilike '%' || $7 || '%' or coalesce(r.raw->>'message', '') ilike '%' || $7 || '%' or bucket.name ilike '%' || $7 || '%')
		order by abs(extract(epoch from (r.date - $6::timestamptz))), r.date desc limit 30`,
		userID, rowID, source.BucketID, source.Currency, -source.Amount, source.Date, q)
	if err != nil {
		return source, nil, err
	}
	defer rows.Close()
	var matches []InboxRow
	for rows.Next() {
		var row InboxRow
		if err := rows.Scan(&row.ID, &row.Date, &row.Amount, &row.Currency, &row.Counterparty, &row.Description, &row.BucketID, &row.Account); err != nil {
			return source, nil, err
		}
		matches = append(matches, row)
	}
	return source, matches, rows.Err()
}

func (d *Data) MatchInboxTransfer(ctx context.Context, userID, rowID, matchID string) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `select r.id, r.date, r.amount, r.currency, coalesce(r.raw->>'payee', ''), coalesce(r.raw->>'message', ''), b.bucket_id
		from import_rows r join import_batches b on b.id = r.batch_id
		where r.id = any($2::uuid[]) and b.user_id = $1 and r.status = 'pending' for update of r`, userID, []string{rowID, matchID})
	if err != nil {
		return err
	}
	defer rows.Close()
	type transferRow struct {
		id                                          string
		date                                        time.Time
		amount                                      int64
		currency, counterparty, description, bucket string
	}
	var pair []transferRow
	for rows.Next() {
		var r transferRow
		if err := rows.Scan(&r.id, &r.date, &r.amount, &r.currency, &r.counterparty, &r.description, &r.bucket); err != nil {
			return err
		}
		pair = append(pair, r)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(pair) != 2 || pair[0].bucket == pair[1].bucket || pair[0].currency != pair[1].currency || pair[0].amount != -pair[1].amount {
		return ErrInvalidPostings
	}

	first, second := pair[0], pair[1]
	outgoing := first
	if second.amount < 0 {
		outgoing = second
	}
	date := first.date
	if second.date.After(date) {
		date = second.date
	}
	txnID, p1, p2 := NewPrivateID(), NewPrivateID(), NewPrivateID()
	if _, err := tx.ExecContext(ctx, `insert into transactions (id, owner_user_id, date, counterparty, description, created_at) values ($1,$2,$3,$4,$5,now())`, txnID, userID, date, outgoing.counterparty, outgoing.description); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `insert into postings (id, transaction_id, bucket_id, amount, currency, created_at) values ($1,$2,$3,$4,$5,now()),($6,$2,$7,$8,$5,now())`, p1, txnID, first.bucket, first.amount, first.currency, p2, second.bucket, second.amount); err != nil {
		return err
	}
	for _, audit := range []struct{ table, id string }{{"transactions", txnID}, {"postings", p1}, {"postings", p2}} {
		if err := auditWrite(ctx, tx, userID, audit.table, audit.id, "insert", nil); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `insert into audit_logs (id, actor_user_id, table_name, row_id, operation, before, created_at) select uuidv7(), $1, 'import_rows', id, 'update', to_jsonb(import_rows), now() from import_rows where id = any($2::uuid[])`, userID, []string{rowID, matchID}); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `update import_rows set status = 'categorized', transaction_id = $1 where id = any($2::uuid[])`, txnID, []string{rowID, matchID}); err != nil {
		return err
	}
	return tx.Commit()
}

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
		"select exists(select 1 from buckets where id = $1 and owner_user_id = $2 and kind in ('expense', 'income', 'person') and hidden = false)",
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
