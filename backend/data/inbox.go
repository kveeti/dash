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

type InboxMatch struct {
	InboxRow
	Kind string
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

// GetInboxMatches returns transfer and exchange candidates. Transfers must be
// equal and opposite in one currency across two accounts. Exchanges must have
// opposite signs in different currencies. ECB rates only rank exchange
// candidates by value; missing rates never hide a candidate.
func (d *Data) GetInboxMatches(ctx context.Context, userID, rowID, q string) (InboxRow, []InboxMatch, error) {
	var source InboxRow
	var sourceExponent int
	var sourceTimezone string
	err := d.db.QueryRowContext(ctx, `select r.id, r.date, r.amount, r.currency,
		coalesce(r.raw->>'payee', ''), coalesce(r.raw->>'message', ''), b.bucket_id, bucket.name, c.exponent, b.timezone
		from import_rows r
		join import_batches b on b.id = r.batch_id
		join buckets bucket on bucket.id = b.bucket_id
		join currencies c on c.code = r.currency
		where r.id = $1 and b.user_id = $2 and r.status = 'pending'`, rowID, userID).
		Scan(&source.ID, &source.Date, &source.Amount, &source.Currency, &source.Counterparty, &source.Description, &source.BucketID, &source.Account, &sourceExponent, &sourceTimezone)
	if err == sql.ErrNoRows {
		return source, nil, ErrNotFound
	}
	if err != nil {
		return source, nil, err
	}

	rows, err := d.db.QueryContext(ctx, `select r.id, r.date, r.amount, r.currency,
		coalesce(r.raw->>'payee', ''), coalesce(r.raw->>'message', ''), b.bucket_id, bucket.name,
		case when r.currency = $4 then 'transfer' else 'exchange' end as kind
		from import_rows r
		join import_batches b on b.id = r.batch_id
		join buckets bucket on bucket.id = b.bucket_id
		join currencies c on c.code = r.currency
		left join lateral (
			select source.rate as source_rate, candidate.rate as candidate_rate
			from rates source
			join rates candidate on candidate.date = source.date and candidate.currency = r.currency
			where source.currency = $4 and source.date <= ($6::timestamptz at time zone $9)::date
			order by source.date desc limit 1
		) fx on r.currency <> $4
		where b.user_id = $1 and r.status = 'pending' and r.id <> $2 and $5::bigint <> 0
		and (r.date at time zone b.timezone)::date between
			(($6::timestamptz at time zone $9)::date - 7) and (($6::timestamptz at time zone $9)::date + 7)
		and (
			(r.currency = $4 and r.amount = -$5::bigint and b.bucket_id <> $3)
			or (r.currency <> $4 and ((r.amount < 0 and $5::bigint > 0) or (r.amount > 0 and $5::bigint < 0)))
		)
		and ($7 = '' or coalesce(r.raw->>'payee', '') ilike '%' || $7 || '%'
			or coalesce(r.raw->>'message', '') ilike '%' || $7 || '%' or bucket.name ilike '%' || $7 || '%')
		order by
			case when r.currency = $4 then 0::numeric else
				abs(
					abs($5::bigint)::numeric / power(10::numeric, $8) / fx.source_rate
					- abs(r.amount)::numeric / power(10::numeric, c.exponent) / fx.candidate_rate
				) / greatest(
					abs($5::bigint)::numeric / power(10::numeric, $8) / fx.source_rate,
					abs(r.amount)::numeric / power(10::numeric, c.exponent) / fx.candidate_rate
				)
			end nulls last,
			abs(extract(epoch from (r.date - $6::timestamptz))),
			(b.bucket_id = $3) desc,
			r.date desc
		limit 30`, userID, rowID, source.BucketID, source.Currency, source.Amount, source.Date, q, sourceExponent, sourceTimezone)
	if err != nil {
		return source, nil, err
	}
	defer rows.Close()

	var matches []InboxMatch
	for rows.Next() {
		var match InboxMatch
		if err := rows.Scan(&match.ID, &match.Date, &match.Amount, &match.Currency, &match.Counterparty, &match.Description, &match.BucketID, &match.Account, &match.Kind); err != nil {
			return source, nil, err
		}
		matches = append(matches, match)
	}
	return source, matches, rows.Err()
}

func (d *Data) MatchInboxRows(ctx context.Context, userID, rowID, matchID string) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	type matchedRow struct {
		id                                                    string
		date                                                  time.Time
		amount                                                int64
		currency, counterparty, description, bucket, timezone string
	}
	rows, err := tx.QueryContext(ctx, `select r.id, r.date, r.amount, r.currency,
		coalesce(r.raw->>'payee', ''), coalesce(r.raw->>'message', ''), b.bucket_id, b.timezone
		from import_rows r join import_batches b on b.id = r.batch_id
		where r.id = any($2::uuid[]) and b.user_id = $1 and r.status = 'pending' for update of r`, userID, []string{rowID, matchID})
	if err != nil {
		return err
	}
	var pair []matchedRow
	for rows.Next() {
		var row matchedRow
		if err := rows.Scan(&row.id, &row.date, &row.amount, &row.currency, &row.counterparty, &row.description, &row.bucket, &row.timezone); err != nil {
			rows.Close()
			return err
		}
		pair = append(pair, row)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(pair) != 2 {
		return ErrInvalidPostings
	}

	first, second := pair[0], pair[1]
	firstLocation, err := time.LoadLocation(first.timezone)
	if err != nil {
		return err
	}
	secondLocation, err := time.LoadLocation(second.timezone)
	if err != nil {
		return err
	}
	firstLocal := first.date.In(firstLocation)
	secondLocal := second.date.In(secondLocation)
	firstDay := time.Date(firstLocal.Year(), firstLocal.Month(), firstLocal.Day(), 0, 0, 0, 0, time.UTC)
	secondDay := time.Date(secondLocal.Year(), secondLocal.Month(), secondLocal.Day(), 0, 0, 0, 0, time.UTC)
	distance := firstDay.Sub(secondDay)
	if distance < -7*24*time.Hour || distance > 7*24*time.Hour {
		return ErrInvalidPostings
	}
	transfer := first.currency == second.currency && first.bucket != second.bucket && first.amount == -second.amount && first.amount != 0
	exchange := first.currency != second.currency && ((first.amount < 0 && second.amount > 0) || (first.amount > 0 && second.amount < 0))
	if !transfer && !exchange {
		return ErrInvalidPostings
	}

	postings := []Posting{
		{BucketID: first.bucket, Amount: first.amount, Currency: first.currency},
		{BucketID: second.bucket, Amount: second.amount, Currency: second.currency},
	}
	if exchange {
		var clearing string
		if err := tx.QueryRowContext(ctx, "select id from buckets where owner_user_id = $1 and kind = 'clearing' and hidden = true", userID).Scan(&clearing); err != nil {
			return err
		}
		postings = append(postings,
			Posting{BucketID: clearing, Amount: -first.amount, Currency: first.currency},
			Posting{BucketID: clearing, Amount: -second.amount, Currency: second.currency},
		)
	}

	outgoing := first
	if second.amount < 0 {
		outgoing = second
	}
	date := first.date
	if second.date.After(date) {
		date = second.date
	}
	txn := Transaction{ID: NewPrivateID(), OwnerUserID: userID, Date: date, Counterparty: outgoing.counterparty, Description: outgoing.description}
	if err := insertTransactionTx(ctx, tx, &txn, postings); err != nil {
		return err
	}
	ids := []string{rowID, matchID}
	if _, err := tx.ExecContext(ctx, `insert into audit_logs (id, actor_user_id, table_name, row_id, operation, before, created_at)
		select uuidv7(), $1, 'import_rows', id, 'update', to_jsonb(import_rows), now()
		from import_rows where id = any($2::uuid[])`, userID, ids); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `update import_rows set status = 'categorized', transaction_id = $1 where id = any($2::uuid[])`, txn.ID, ids); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return nil
}

func (d *Data) RestoreInboxRows(ctx context.Context, userID string, rowIDs []string) (int, error) {
	if len(rowIDs) == 0 {
		return 0, nil
	}
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `select t.id
		from transactions t
		where t.owner_user_id = $1 and exists (
			select 1 from import_rows r
			join import_batches b on b.id = r.batch_id
			where r.id = any($2::uuid[]) and b.user_id = $1 and r.transaction_id = t.id
		) for update`, userID, rowIDs)
	if err != nil {
		return 0, err
	}
	var transactionIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		transactionIDs = append(transactionIDs, id)
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(transactionIDs) == 0 {
		return 0, nil
	}

	restored, err := removeTransactionsTx(ctx, tx, userID, transactionIDs)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return restored, nil
}

func (d *Data) CategorizeInboxRows(ctx context.Context, userID string, rowIDs []string, bucketID string) (int, error) {
	return d.categorizeInboxRows(ctx, userID, rowIDs, bucketID, nil)
}

func (d *Data) CreateBucketAndCategorizeInboxRows(ctx context.Context, userID string, rowIDs []string, bucket Bucket) (int, error) {
	return d.categorizeInboxRows(ctx, userID, rowIDs, bucket.ID, &bucket)
}

func (d *Data) categorizeInboxRows(ctx context.Context, userID string, rowIDs []string, bucketID string, bucket *Bucket) (int, error) {
	if len(rowIDs) == 0 {
		return 0, nil
	}
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	if bucket == nil {
		var valid bool
		if err := tx.QueryRowContext(ctx,
			"select exists(select 1 from buckets where id = $1 and owner_user_id = $2 and kind in ('expense', 'income', 'person') and hidden = false)",
			bucketID, userID).Scan(&valid); err != nil {
			return 0, err
		}
		if !valid {
			return 0, ErrInvalidCategory
		}
	} else {
		validKind := bucket.Kind == KindExpense || bucket.Kind == KindIncome || bucket.Kind == KindPerson
		if bucket.OwnerUserID != userID || !validKind || bucket.Hidden {
			return 0, ErrInvalidCategory
		}
		if err := insertBucketTx(ctx, tx, *bucket); err != nil {
			return 0, err
		}
	}

	var categorized int
	if err := tx.QueryRowContext(ctx, categorizeInboxSQL, userID, rowIDs, bucketID).Scan(&categorized); err != nil {
		return 0, err
	}
	if bucket != nil && categorized == 0 {
		return 0, nil
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return categorized, nil
}
