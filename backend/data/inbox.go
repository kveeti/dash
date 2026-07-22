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

// categorizeInboxSQL locks each source row and creates one exact import link.
const categorizeInboxSQL = `
with rows as materialized (
    select r.id as row_id, r.date, r.amount, r.currency,
           coalesce(r.raw->>'payee', '') as payee, coalesce(r.raw->>'message', '') as message, b.bucket_id,
           uuidv7() as txn_id, uuidv7() as p1, uuidv7() as p2
    from import_rows r
    join import_batches b on b.id = r.batch_id
    where r.id = any($2::uuid[]) and b.user_id = $1 and r.status = 'pending'
    for update of r
),
ins_txn as (
    insert into transactions (id, owner_user_id, occurred_at, counterparty, description, memo, created_at)
    select txn_id, $1, date, payee, message, '', now() from rows
),
ins_post as (
    insert into postings (id, transaction_id, bucket_id, amount, currency, import_row_id, created_at)
    select p1, txn_id, bucket_id, amount, currency, row_id, now() from rows
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
    update import_rows set status = 'categorized'
    from rows r where import_rows.id = r.row_id
)
select count(*) from rows`

// GetInboxMatches returns transfer and exchange candidates. Transfers must be
// equal and opposite in one currency across two accounts. Exchanges must have
// opposite signs in different currencies. ECB rates only rank exchange
// candidates by value; missing rates never hide a candidate.
func (d *Data) GetInboxMatches(ctx context.Context, userID, rowID, q string) (InboxRow, []InboxMatch, error) {
	rows, err := d.db.QueryContext(ctx, `
		with source as materialized (
			select r.id, r.date, r.amount, r.currency,
				coalesce(r.raw->>'payee', '') as counterparty,
				coalesce(r.raw->>'message', '') as description,
				b.bucket_id, bucket.name as account, c.exponent, b.timezone
			from import_rows r
			join import_batches b on b.id = r.batch_id
			join buckets bucket on bucket.id = b.bucket_id
			join currencies c on c.code = r.currency
			where r.id = $2 and b.user_id = $1 and r.status = 'pending'
		)
		select s.id, s.date, s.amount, s.currency, s.counterparty, s.description, s.bucket_id, s.account,
			m.id, m.date, m.amount, m.currency, m.counterparty, m.description, m.bucket_id, m.account, m.kind
		from source s
		left join lateral (
			select r.id, r.date, r.amount, r.currency,
				coalesce(r.raw->>'payee', '') as counterparty,
				coalesce(r.raw->>'message', '') as description,
				b.bucket_id, bucket.name as account,
				case when r.currency = s.currency then 'transfer' else 'exchange' end as kind,
				case when r.currency = s.currency then 0::numeric else
					abs(
						abs(s.amount)::numeric / power(10::numeric, s.exponent) / fx.source_rate
						- abs(r.amount)::numeric / power(10::numeric, c.exponent) / fx.candidate_rate
					) / greatest(
						abs(s.amount)::numeric / power(10::numeric, s.exponent) / fx.source_rate,
						abs(r.amount)::numeric / power(10::numeric, c.exponent) / fx.candidate_rate
					)
				end as value_distance,
				abs(extract(epoch from (r.date - s.date))) as time_distance,
				(b.bucket_id = s.bucket_id) as same_account
			from import_rows r
			join import_batches b on b.id = r.batch_id
			join buckets bucket on bucket.id = b.bucket_id
			join currencies c on c.code = r.currency
			left join lateral (
				select source_rate.rate as source_rate, candidate_rate.rate as candidate_rate
				from rates source_rate
				join rates candidate_rate on candidate_rate.date = source_rate.date and candidate_rate.currency = r.currency
				where source_rate.currency = s.currency
				  and source_rate.date <= (s.date at time zone s.timezone)::date
				order by source_rate.date desc
				limit 1
			) fx on r.currency <> s.currency
			where b.user_id = $1 and r.status = 'pending' and r.id <> s.id and s.amount <> 0
			  and (r.date at time zone b.timezone)::date between
				((s.date at time zone s.timezone)::date - 7) and ((s.date at time zone s.timezone)::date + 7)
			  and (
				(r.currency = s.currency and r.amount = -s.amount and b.bucket_id <> s.bucket_id)
				or (r.currency <> s.currency and ((r.amount < 0 and s.amount > 0) or (r.amount > 0 and s.amount < 0)))
			  )
			  and ($3 = '' or coalesce(r.raw->>'payee', '') ilike '%' || $3 || '%'
				or coalesce(r.raw->>'message', '') ilike '%' || $3 || '%' or bucket.name ilike '%' || $3 || '%')
			order by value_distance nulls last, time_distance, same_account desc, r.date desc
			limit 30
		) m on true
		order by m.value_distance nulls last, m.time_distance, m.same_account desc, m.date desc
	`, userID, rowID, q)
	if err != nil {
		return InboxRow{}, nil, err
	}
	defer rows.Close()

	var source InboxRow
	var matches []InboxMatch
	found := false
	for rows.Next() {
		found = true
		var (
			matchID, matchCurrency, matchCounterparty, matchDescription sql.NullString
			matchBucketID, matchAccount, matchKind                      sql.NullString
			matchDate                                                   sql.NullTime
			matchAmount                                                 sql.NullInt64
		)
		if err := rows.Scan(
			&source.ID, &source.Date, &source.Amount, &source.Currency, &source.Counterparty, &source.Description, &source.BucketID, &source.Account,
			&matchID, &matchDate, &matchAmount, &matchCurrency, &matchCounterparty, &matchDescription, &matchBucketID, &matchAccount, &matchKind,
		); err != nil {
			return source, nil, err
		}
		if matchID.Valid {
			matches = append(matches, InboxMatch{
				InboxRow: InboxRow{
					ID: matchID.String, Date: matchDate.Time, Amount: matchAmount.Int64,
					Currency: matchCurrency.String, Counterparty: matchCounterparty.String,
					Description: matchDescription.String, BucketID: matchBucketID.String, Account: matchAccount.String,
				},
				Kind: matchKind.String,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return source, nil, err
	}
	if !found {
		return source, nil, ErrNotFound
	}
	return source, matches, nil
}

func (d *Data) MatchInboxRows(ctx context.Context, userID, rowID, matchID string) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	type row struct {
		id                                                    string
		date                                                  time.Time
		amount                                                int64
		currency, counterparty, description, bucket, timezone string
	}
	rows, err := tx.QueryContext(ctx, `select r.id,r.date,r.amount,r.currency,coalesce(r.raw->>'payee',''),coalesce(r.raw->>'message',''),b.bucket_id,b.timezone
		from import_rows r join import_batches b on b.id=r.batch_id where r.id=any($2::uuid[]) and b.user_id=$1 and r.status='pending' for update of r`, userID, []string{rowID, matchID})
	if err != nil {
		return err
	}
	var pair []row
	for rows.Next() {
		var r row
		if err = rows.Scan(&r.id, &r.date, &r.amount, &r.currency, &r.counterparty, &r.description, &r.bucket, &r.timezone); err != nil {
			rows.Close()
			return err
		}
		pair = append(pair, r)
	}
	if err = rows.Close(); err != nil {
		return err
	}
	if err = rows.Err(); err != nil {
		return err
	}
	if len(pair) != 2 {
		return ErrInvalidPostings
	}
	a, b := pair[0], pair[1]
	localDay := func(r row) (time.Time, error) {
		loc, e := time.LoadLocation(r.timezone)
		if e != nil {
			return time.Time{}, e
		}
		x := r.date.In(loc)
		return time.Date(x.Year(), x.Month(), x.Day(), 0, 0, 0, 0, time.UTC), nil
	}
	ad, err := localDay(a)
	if err != nil {
		return err
	}
	bd, err := localDay(b)
	if err != nil {
		return err
	}
	distance := ad.Sub(bd)
	if distance < -7*24*time.Hour || distance > 7*24*time.Hour {
		return ErrInvalidPostings
	}
	transfer := a.currency == b.currency && a.bucket != b.bucket && a.amount == -b.amount && a.amount != 0
	exchange := a.currency != b.currency && ((a.amount < 0 && b.amount > 0) || (a.amount > 0 && b.amount < 0))
	if !transfer && !exchange {
		return ErrInvalidPostings
	}
	var transit, fx string
	if err = tx.QueryRowContext(ctx, `
		select id
		from buckets
		where owner_user_id = $1
		  and kind = 'transit'
	`, userID).Scan(&transit); err != nil {
		return err
	}
	if exchange {
		if err = tx.QueryRowContext(ctx, `
			select id
			from buckets
			where owner_user_id = $1
			  and kind = 'fx_conversion'
		`, userID).Scan(&fx); err != nil {
			return err
		}
	}
	// Exchange settlement follows source time, with the outgoing row first on a tie.
	first, second := a, b
	if second.date.Before(first.date) || (second.date.Equal(first.date) && second.amount < 0) {
		first, second = second, first
	}
	ids := map[string]string{}
	create := func(r row, postings []Posting) error {
		rid := r.id
		txn := Transaction{ID: NewPrivateID(), OwnerUserID: userID, OccurredAt: r.date, Counterparty: r.counterparty, Description: r.description}
		postings[0].ImportRowID = &rid
		if err := insertTransactionTx(ctx, tx, &txn, postings); err != nil {
			return err
		}
		ids[r.id] = txn.ID
		return nil
	}
	if transfer {
		if err = create(a, []Posting{{BucketID: a.bucket, Amount: a.amount, Currency: a.currency}, {BucketID: transit, Amount: -a.amount, Currency: a.currency}}); err != nil {
			return err
		}
		if err = create(b, []Posting{{BucketID: b.bucket, Amount: b.amount, Currency: b.currency}, {BucketID: transit, Amount: -b.amount, Currency: b.currency}}); err != nil {
			return err
		}
	} else {
		if err = create(first, []Posting{{BucketID: first.bucket, Amount: first.amount, Currency: first.currency}, {BucketID: transit, Amount: -first.amount, Currency: first.currency}}); err != nil {
			return err
		}
		if err = create(second, []Posting{{BucketID: second.bucket, Amount: second.amount, Currency: second.currency}, {BucketID: fx, Amount: -second.amount, Currency: second.currency}, {BucketID: transit, Amount: first.amount, Currency: first.currency}, {BucketID: fx, Amount: -first.amount, Currency: first.currency}}); err != nil {
			return err
		}
	}
	var transitClear bool
	if err = tx.QueryRowContext(ctx, `
		select not exists (
			select 1
			from postings
			where transaction_id = any($1::uuid[])
			  and bucket_id = $2
			group by currency
			having sum(amount) <> 0
		)
	`, []string{ids[a.id], ids[b.id]}, transit).Scan(&transitClear); err != nil {
		return err
	}
	if !transitClear {
		return ErrUnbalanced
	}
	out, in := a, b
	if in.amount < 0 {
		out, in = in, out
	}
	_, err = tx.ExecContext(ctx, `
		with added as (
			insert into account_movement_matches (
				id, owner_user_id, outgoing_transaction_id, incoming_transaction_id, created_at
			)
			values (uuidv7(), $1, $2, $3, now())
			returning id
		)
		insert into audit_logs
		select uuidv7(), $1, 'account_movement_matches', id, 'insert', null, now()
		from added
	`, userID, ids[out.id], ids[in.id])
	if err != nil {
		return err
	}
	rowIDs := []string{a.id, b.id}
	_, err = tx.ExecContext(ctx, `
		insert into audit_logs (
			id, actor_user_id, table_name, row_id, operation, before, created_at
		)
		select uuidv7(), $1, 'import_rows', id, 'update', to_jsonb(import_rows), now()
		from import_rows
		where id = any($2::uuid[])
	`, userID, rowIDs)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		update import_rows
		set status = 'categorized'
		where id = any($1::uuid[])
	`, rowIDs)
	if err != nil {
		return err
	}
	return tx.Commit()
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
		from transactions t join postings p on p.transaction_id=t.id
		join import_rows r on r.id=p.import_row_id join import_batches b on b.id=r.batch_id
		where t.owner_user_id=$1 and r.id=any($2::uuid[]) and b.user_id=$1 for update of t`, userID, rowIDs)
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
		if err := tx.QueryRowContext(ctx, `
			select exists (
				select 1
				from buckets
				where id = $1
				  and owner_user_id = $2
				  and kind in ('expense', 'income', 'person')
				  and hidden = false
			)
		`, bucketID, userID).Scan(&valid); err != nil {
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
