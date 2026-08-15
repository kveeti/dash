package data

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math/big"
	"strconv"
	"strings"
	"time"
)

var (
	ErrUnbalanced         = errors.New("transaction does not balance: each currency must net to zero")
	ErrInvalidPostings    = errors.New("transaction needs at least two postings with nonzero amounts")
	ErrInvalidBucket      = errors.New("posting references a bucket you do not own")
	ErrInvalidCategory    = errors.New("bucket is not a category you own")
	ErrInvalidCurrency    = errors.New("unsupported currency")
	ErrNotFound           = errors.New("transaction not found")
	ErrPostingNotEditable = errors.New("posting cannot be edited")
	ErrTransferSplit      = errors.New("transfer transactions cannot be split")
	ErrPostingConflict    = errors.New("transaction postings changed since you opened the editor")
)

type Transaction struct {
	ID           string
	OwnerUserID  string
	OccurredOn   time.Time
	OccurredAt   *time.Time
	Counterparty string
	Description  string
	Memo         string
	CreatedAt    time.Time
	Transfer     *TransferInfo
}

type TransferInfo struct {
	MatchID               string
	Side                  string
	CounterpartID         string
	CounterpartOccurredOn time.Time
	CounterpartOccurredAt *time.Time
	CounterpartBucket     *PostingBucket
	CounterpartAmount     int64
	CounterpartCurrency   string
	Unmatched             bool
}

type PostingBucket struct {
	ID   string
	Name string
	Kind BucketKind
}

type Posting struct {
	ID          string
	BucketID    string
	Bucket      PostingBucket `json:"-"`
	Amount      int64
	Currency    string
	StatsDate   *time.Time
	Memo        string
	ImportRowID *string
	MirrorID    *string
	Tags        []string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func insertTransactionTx(ctx context.Context, tx *sql.Tx, txn *Transaction, postings []Posting) error {
	if err := validatePostings(postings); err != nil {
		return err
	}
	txn.CreatedAt = time.Now().UTC()
	_, err := tx.ExecContext(ctx, `
		insert into transactions (
			id, owner_user_id, occurred_on, occurred_at, counterparty, description, memo, created_at
		)
		values ($1, $2, $3, $4, $5, $6, $7, $8)
	`, txn.ID, txn.OwnerUserID, txn.OccurredOn, txn.OccurredAt,
		txn.Counterparty, txn.Description, txn.Memo, txn.CreatedAt)
	if err != nil {
		return err
	}
	if err = auditWrite(ctx, tx, txn.OwnerUserID, "transactions", txn.ID, "insert", nil); err != nil {
		return err
	}
	for i := range postings {
		if postings[i].ID == "" {
			postings[i].ID = NewPrivateID()
		}
		p := postings[i]
		_, err = tx.ExecContext(ctx, `
			insert into postings (
				id, transaction_id, bucket_id, amount, currency, stats_date, memo,
				import_row_id, mirror_id, created_at
			)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
		`, p.ID, txn.ID, p.BucketID,
			p.Amount, p.Currency, p.StatsDate, p.Memo, p.ImportRowID, p.MirrorID)
		if err != nil {
			return err
		}
		if err = auditWrite(ctx, tx, txn.OwnerUserID, "postings", p.ID, "insert", nil); err != nil {
			return err
		}
	}
	return nil
}

func validatePostings(postings []Posting) error {
	if len(postings) < 2 {
		return ErrInvalidPostings
	}
	sums := map[string]*big.Int{}
	for _, p := range postings {
		if p.Amount == 0 || p.Currency == "" {
			return ErrInvalidPostings
		}
		if sums[p.Currency] == nil {
			sums[p.Currency] = new(big.Int)
		}
		sums[p.Currency].Add(sums[p.Currency], big.NewInt(p.Amount))
	}
	for _, sum := range sums {
		if sum.Sign() != 0 {
			return ErrUnbalanced
		}
	}
	return nil
}

// BulkCategorize only moves a user posting. Imported and system postings stay fixed.
func (d *Data) BulkCategorize(ctx context.Context, userID string, txnIDs []string, bucketID string) (int, error) {
	if len(txnIDs) == 0 {
		return 0, nil
	}
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var valid bool
	err = tx.QueryRowContext(ctx, `
		select exists (
			select 1
			from buckets
			where id = $1
			  and owner_user_id = $2
			  and kind in ('expense', 'income', 'person')
			  and hidden = false
		)
	`, bucketID, userID).Scan(&valid)
	if err != nil {
		return 0, err
	}
	if !valid {
		return 0, ErrInvalidCategory
	}
	const scope = `
		p.transaction_id = any($2::uuid[])
		and p.import_row_id is null
		and p.bucket_id in (
			select id
			from buckets
			where owner_user_id = $1
			  and kind in ('expense', 'income', 'person')
			  and hidden = false
		)
		and (
			select count(*)
			from postings p2
			join buckets b2 on b2.id = p2.bucket_id
			where p2.transaction_id = p.transaction_id
			  and b2.kind in ('expense', 'income', 'person')
			  and b2.hidden = false
		) = 1`
	_, err = tx.ExecContext(ctx, `
		insert into audit_logs (
			id, actor_user_id, table_name, row_id, operation, before, created_at
		)
		select uuidv7(), $1, 'postings', p.id, 'update', to_jsonb(p), now()
		from postings p
		where `+scope, userID, txnIDs)
	if err != nil {
		return 0, err
	}
	res, err := tx.ExecContext(ctx, `
		update postings p
		set bucket_id = $3, updated_at = clock_timestamp()
		where `+scope, userID, txnIDs, bucketID)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return int(n), nil
}

func (d *Data) PatchTransactionMemo(ctx context.Context, userID, id, memo string) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	old, err := loadOwnedTransaction(ctx, tx, userID, id)
	if err != nil {
		return err
	}
	if err = auditWrite(ctx, tx, userID, "transactions", id, "update", old); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `
		update transactions
		set memo = $1
		where id = $2
	`, memo, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (d *Data) CategorizePosting(ctx context.Context, userID, id, bucketID string) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var old Posting
	var editable bool
	err = tx.QueryRowContext(ctx, `
		select
			p.id, p.bucket_id, p.amount, p.currency, p.stats_date, p.memo,
			p.import_row_id, p.mirror_id,
			p.import_row_id is null
				and not b.hidden
				and b.kind in ('expense', 'income')
				and not exists (
					select 1
					from postings p3
					join buckets b3 on b3.id = p3.bucket_id
					where p3.transaction_id = p.transaction_id
					  and b3.kind = 'transit'
				)
		from postings p
		join transactions t on t.id = p.transaction_id
		join buckets b on b.id = p.bucket_id
		where p.id = $1
		  and t.owner_user_id = $2
		for update of p
	`, id, userID).Scan(
		&old.ID, &old.BucketID, &old.Amount, &old.Currency, &old.StatsDate, &old.Memo,
		&old.ImportRowID, &old.MirrorID, &editable,
	)
	if err == sql.ErrNoRows {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if !editable {
		return ErrPostingNotEditable
	}

	var valid bool
	if err = tx.QueryRowContext(ctx, `
		select exists (
			select 1
			from buckets
			where id = $1
			  and owner_user_id = $2
			  and kind in ('expense', 'income')
			  and hidden = false
		)
	`, bucketID, userID).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return ErrInvalidCategory
	}
	if err = auditWrite(ctx, tx, userID, "postings", id, "update", old); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `
		update postings
		set bucket_id = $1, updated_at = clock_timestamp()
		where id = $2
	`, bucketID, id); err != nil {
		return err
	}
	return tx.Commit()
}

func loadOwnedTransaction(ctx context.Context, tx *sql.Tx, userID, id string) (*Transaction, error) {
	var t Transaction
	err := tx.QueryRowContext(ctx, `
		select id, owner_user_id, occurred_on, occurred_at, counterparty, description, memo, created_at
		from transactions
		where id = $1
		  and owner_user_id = $2
		for update
	`, id, userID).Scan(&t.ID, &t.OwnerUserID, &t.OccurredOn, &t.OccurredAt, &t.Counterparty, &t.Description, &t.Memo, &t.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return &t, err
}

func (d *Data) RemoveTransactions(ctx context.Context, userID string, ids []string) (int, int, error) {
	if len(ids) == 0 {
		return 0, 0, nil
	}
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `
		select id
		from transactions
		where owner_user_id = $1
		  and id = any($2::uuid[])
		for update
	`, userID, ids)
	if err != nil {
		return 0, 0, err
	}
	var owned []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return 0, 0, err
		}
		owned = append(owned, id)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return 0, 0, err
	}
	if len(owned) == 0 {
		return 0, 0, nil
	}
	restored, err := removeTransactionsTx(ctx, tx, userID, owned)
	if err != nil {
		return 0, 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, 0, err
	}
	return len(owned), restored, nil
}

func removeTransactionsTx(ctx context.Context, tx *sql.Tx, userID string, ids []string) (int, error) {
	// Removing one side drops the match first, leaving its counterpart as an unmatched side.
	_, err := tx.ExecContext(ctx, `
		with doomed as materialized (
			select *
			from account_movement_matches
			where owner_user_id = $1
			  and (
				outgoing_transaction_id = any($2::uuid[])
				or incoming_transaction_id = any($2::uuid[])
			  )
		), audited as (
			insert into audit_logs
			select uuidv7(), $1, 'account_movement_matches', id, 'delete', to_jsonb(doomed), now()
			from doomed
		)
		delete from account_movement_matches
		where id in (select id from doomed)
	`, userID, ids)
	if err != nil {
		return 0, err
	}
	_, err = tx.ExecContext(ctx, `
		insert into audit_logs (
			id, actor_user_id, table_name, row_id, operation, before, created_at
		)
		select uuidv7(), $1, 'import_rows', r.id, 'update', to_jsonb(r), now()
		from import_rows r
		join postings p on p.import_row_id = r.id
		where p.transaction_id = any($2::uuid[])
	`, userID, ids)
	if err != nil {
		return 0, err
	}
	res, err := tx.ExecContext(ctx, `
		update import_rows r
		set status = 'pending'
		from postings p
		where p.import_row_id = r.id
		  and p.transaction_id = any($1::uuid[])
	`, ids)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	_, err = tx.ExecContext(ctx, `
		with doomed as (
			select pt.*
			from posting_tags pt
			join postings p on p.id = pt.posting_id
			where p.transaction_id = any($2::uuid[])
		), audited as (
			insert into audit_logs
			select uuidv7(), $1, 'posting_tags', id, 'delete', to_jsonb(doomed), now()
			from doomed
		)
		delete from posting_tags
		where id in (select id from doomed)
	`, userID, ids)
	if err != nil {
		return 0, err
	}
	for _, table := range []string{"postings", "transactions"} {
		where := "transaction_id=any($2::uuid[])"
		if table == "transactions" {
			where = "id=any($2::uuid[])"
		}
		_, err = tx.ExecContext(ctx, `
			with doomed as (
				select *
				from `+table+`
				where `+where+`
			), audited as (
				insert into audit_logs
				select uuidv7(), $1, '`+table+`', id, 'delete', to_jsonb(doomed), now()
				from doomed
			)
			delete from `+table+`
			where id in (select id from doomed)
		`, userID, ids)
		if err != nil {
			return 0, err
		}
	}
	return int(n), nil
}

func (d *Data) UnmatchTransfer(ctx context.Context, userID, matchID string) (int, error) {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var ids []string
	var a, b string
	err = tx.QueryRowContext(ctx, `
		select outgoing_transaction_id, incoming_transaction_id
		from account_movement_matches
		where id = $1
		  and owner_user_id = $2
		for update
	`, matchID, userID).Scan(&a, &b)
	if err == sql.ErrNoRows {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	ids = []string{a, b}
	n, err := removeTransactionsTx(ctx, tx, userID, ids)
	if err != nil {
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return n, nil
}

func (d *Data) DeleteTransaction(ctx context.Context, userID, id string) error {
	n, _, err := d.RemoveTransactions(ctx, userID, []string{id})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

const TransactionPageSize = 100

type TransactionFilter struct {
	Search                       string
	Categories, Tags, Accounts   []string
	Direction, Currency          string
	Amount, AmountMin, AmountMax *int64
	OccurredFrom, OccurredBefore *time.Time
}

func (d *Data) ListTransactions(ctx context.Context, userID, timezone string, cursor time.Time, cursorID string, filter TransactionFilter) ([]Transaction, map[string][]Posting, error) {
	args := []any{userID, timezone != ""}
	addArg := func(value any) string {
		args = append(args, value)
		return "$" + strconv.Itoa(len(args))
	}
	clauses := []string{}
	if cursorID != "" {
		clauses = append(clauses, "and (t.occurred_on, t.id) < ("+addArg(cursor)+"::date, "+addArg(cursorID)+"::uuid)")
	}
	if filter.Search != "" {
		arg := addArg("%" + filter.Search + "%")
		clauses = append(clauses, "and (t.counterparty ilike "+arg+" or t.description ilike "+arg+")")
	}
	if len(filter.Categories) > 0 {
		arg := addArg(filter.Categories)
		clauses = append(clauses, `and exists (
			select 1 from postings p
			join buckets b on b.id=p.bucket_id
			where p.transaction_id=t.id
			  and b.kind in ('expense','income','person')
			  and p.bucket_id=any(`+arg+`::uuid[])
		)`)
	}
	if len(filter.Tags) > 0 {
		for i, tag := range filter.Tags {
			filter.Tags[i] = normalizeTag(tag)
		}
		arg := addArg(filter.Tags)
		clauses = append(clauses, `and exists (
			select 1 from posting_tags pt
			join postings p on p.id=pt.posting_id
			where p.transaction_id=t.id and pt.tag=any(`+arg+`::text[])
		)`)
	}
	if filter.OccurredFrom != nil {
		clauses = append(clauses, "and t.occurred_on >= "+addArg(*filter.OccurredFrom)+"::date")
	}
	if filter.OccurredBefore != nil {
		clauses = append(clauses, "and t.occurred_on < "+addArg(*filter.OccurredBefore)+"::date")
	}
	if len(filter.Accounts) > 0 || filter.Direction != "" || filter.Amount != nil || filter.AmountMin != nil || filter.AmountMax != nil {
		legClauses := []string{"b.kind in ('asset','liability')"}
		if len(filter.Accounts) > 0 {
			legClauses = append(legClauses, "p.bucket_id=any("+addArg(filter.Accounts)+"::uuid[])")
		}
		if filter.Direction == "in" {
			legClauses = append(legClauses, "p.amount > 0")
		} else if filter.Direction == "out" {
			legClauses = append(legClauses, "p.amount < 0")
		}
		if filter.Currency != "" {
			legClauses = append(legClauses, "p.currency="+addArg(filter.Currency))
		}
		if filter.Amount != nil {
			legClauses = append(legClauses, "abs(p.amount)="+addArg(*filter.Amount))
		}
		if filter.AmountMin != nil {
			legClauses = append(legClauses, "abs(p.amount)>= "+addArg(*filter.AmountMin))
		}
		if filter.AmountMax != nil {
			legClauses = append(legClauses, "abs(p.amount)<= "+addArg(*filter.AmountMax))
		}
		clauses = append(clauses, `and exists (
			select 1
			from postings p join buckets b on b.id=p.bucket_id
			where p.transaction_id in (
				t.id,
				coalesce((
					select case when m.outgoing_transaction_id=t.id then m.incoming_transaction_id else m.outgoing_transaction_id end
					from account_movement_matches m
					where m.outgoing_transaction_id=t.id or m.incoming_transaction_id=t.id
					limit 1
				), t.id)
			)
			and `+strings.Join(legClauses, " and ")+`
		)`)
	}
	rows, err := d.db.QueryContext(ctx, `with page as materialized (
		select t.id,t.owner_user_id,t.occurred_on,t.occurred_at,t.counterparty,t.description,t.memo,t.created_at from transactions t
		where t.owner_user_id=$1 `+strings.Join(clauses, " ")+`
		and not exists (
			select 1 from account_movement_matches movement
			join transactions outgoing on outgoing.id=movement.outgoing_transaction_id
			where movement.owner_user_id=t.owner_user_id and movement.incoming_transaction_id=t.id
			  and $2 and outgoing.occurred_on=t.occurred_on
		)
		order by t.occurred_on desc,t.id desc limit `+strconv.Itoa(TransactionPageSize)+`
	), page_postings as (
		select p.id,p.transaction_id,p.bucket_id,b.name as bucket_name,b.kind as bucket_kind,p.amount,p.currency,p.stats_date,p.memo,p.import_row_id,p.mirror_id,p.created_at,p.updated_at,
			coalesce(jsonb_agg(pt.tag order by pt.tag) filter(where pt.tag is not null),'[]'::jsonb) as tags
		from page join postings p on p.transaction_id=page.id join buckets b on b.id=p.bucket_id and b.hidden=false
		left join posting_tags pt on pt.posting_id=p.id
		group by p.id,b.id
	), transit_transactions as (
		select distinct p.transaction_id from page join postings p on p.transaction_id=page.id join buckets b on b.id=p.bucket_id and b.kind='transit'
	)
	select page.id,page.owner_user_id,page.occurred_on,page.occurred_at,page.counterparty,page.description,page.memo,page.created_at,
		p.id,p.bucket_id,p.bucket_name,p.bucket_kind,p.amount,p.currency,p.stats_date,p.memo,p.import_row_id,p.mirror_id,p.created_at,p.updated_at,p.tags,
		coalesce(outgoing_match.id,incoming_match.id),
		case
			when outgoing_match.id is not null then 'outgoing'
			when incoming_match.id is not null then 'incoming'
			when transit_transactions.transaction_id is not null and p.amount < 0 then 'outgoing'
			when transit_transactions.transaction_id is not null then 'incoming'
		end,
		counterpart.id,counterpart.occurred_on,counterpart.occurred_at,counterpart_bucket.id,counterpart_bucket.name,counterpart_bucket.kind,
		counterpart_posting.amount,counterpart_posting.currency,
		transit_transactions.transaction_id is not null and outgoing_match.id is null and incoming_match.id is null
	from page
	join page_postings p on p.transaction_id=page.id
	left join account_movement_matches outgoing_match on outgoing_match.outgoing_transaction_id=page.id
	left join account_movement_matches incoming_match on incoming_match.incoming_transaction_id=page.id
	left join transactions counterpart on counterpart.id=coalesce(outgoing_match.incoming_transaction_id,incoming_match.outgoing_transaction_id)
	left join postings counterpart_posting on counterpart_posting.transaction_id=counterpart.id and counterpart_posting.import_row_id is not null
	left join buckets counterpart_bucket on counterpart_bucket.id=counterpart_posting.bucket_id
	left join transit_transactions on transit_transactions.transaction_id=page.id
	order by page.occurred_on desc,page.id desc,p.created_at,p.id`, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var out []Transaction
	ps := map[string][]Posting{}
	seen := map[string]bool{}
	for rows.Next() {
		var t Transaction
		var p Posting
		var tags []byte
		var matchID, side, counterpartID, counterpartBucketID, counterpartBucketName, counterpartBucketKind, counterpartCurrency sql.NullString
		var counterpartOccurredOn, counterpartOccurredAt sql.NullTime
		var counterpartAmount sql.NullInt64
		var unmatched bool
		if err = rows.Scan(&t.ID, &t.OwnerUserID, &t.OccurredOn, &t.OccurredAt, &t.Counterparty, &t.Description, &t.Memo, &t.CreatedAt,
			&p.ID, &p.Bucket.ID, &p.Bucket.Name, &p.Bucket.Kind, &p.Amount, &p.Currency, &p.StatsDate, &p.Memo, &p.ImportRowID, &p.MirrorID, &p.CreatedAt, &p.UpdatedAt, &tags,
			&matchID, &side, &counterpartID, &counterpartOccurredOn, &counterpartOccurredAt, &counterpartBucketID, &counterpartBucketName, &counterpartBucketKind,
			&counterpartAmount, &counterpartCurrency, &unmatched); err != nil {
			return nil, nil, err
		}
		p.BucketID = p.Bucket.ID
		p.Tags = []string{}
		if err = json.Unmarshal(tags, &p.Tags); err != nil {
			return nil, nil, err
		}
		if matchID.Valid {
			t.Transfer = &TransferInfo{
				MatchID:               matchID.String,
				Side:                  side.String,
				CounterpartID:         counterpartID.String,
				CounterpartOccurredOn: counterpartOccurredOn.Time,
				CounterpartBucket:     &PostingBucket{ID: counterpartBucketID.String, Name: counterpartBucketName.String, Kind: BucketKind(counterpartBucketKind.String)},
				CounterpartAmount:     counterpartAmount.Int64,
				CounterpartCurrency:   counterpartCurrency.String,
			}
			if counterpartOccurredAt.Valid {
				t.Transfer.CounterpartOccurredAt = &counterpartOccurredAt.Time
			}
		} else if unmatched {
			t.Transfer = &TransferInfo{Side: side.String, Unmatched: true}
		}
		if !seen[t.ID] {
			seen[t.ID] = true
			out = append(out, t)
		}
		ps[t.ID] = append(ps[t.ID], p)
	}
	if err = rows.Err(); err != nil {
		return nil, nil, err
	}
	return out, ps, nil
}

func (d *Data) GetTransaction(ctx context.Context, userID, id string) (*Transaction, []Posting, error) {
	rows, err := d.db.QueryContext(ctx, `
		with target as materialized (
			select id, owner_user_id, occurred_on, occurred_at, counterparty, description, memo, created_at
			from transactions
			where id = $1 and owner_user_id = $2
		), target_postings as (
			select p.id, p.transaction_id, p.bucket_id, b.name as bucket_name, b.kind as bucket_kind,
				p.amount, p.currency, p.stats_date, p.memo, p.import_row_id, p.mirror_id, p.created_at, p.updated_at,
				coalesce(jsonb_agg(pt.tag order by pt.tag) filter (where pt.tag is not null), '[]'::jsonb) as tags
			from target
			join postings p on p.transaction_id = target.id
			join buckets b on b.id = p.bucket_id and b.hidden = false
			left join posting_tags pt on pt.posting_id = p.id
			group by p.id, b.id
		), matched_sides as (
			select m.id as match_id, m.outgoing_transaction_id as transaction_id,
				m.incoming_transaction_id as counterpart_id, 'outgoing' as side
			from target
			join account_movement_matches m on m.outgoing_transaction_id = target.id

			union all

			select m.id, m.incoming_transaction_id, m.outgoing_transaction_id, 'incoming'
			from target
			join account_movement_matches m on m.incoming_transaction_id = target.id
		), matched_transfer as (
			select s.match_id, s.transaction_id, s.counterpart_id, s.side,
				counterpart.occurred_on, counterpart.occurred_at, b.id as bucket_id, b.name as bucket_name, b.kind as bucket_kind,
				p.amount, p.currency
			from matched_sides s
			join transactions counterpart on counterpart.id = s.counterpart_id
			join postings p on p.transaction_id = counterpart.id and p.import_row_id is not null
			join buckets b on b.id = p.bucket_id
		), unmatched_transfer as (
			select distinct p.transaction_id,
				case when imported.amount < 0 then 'outgoing' else 'incoming' end as side
			from target
			join postings p on p.transaction_id = target.id
			join buckets b on b.id = p.bucket_id and b.kind = 'transit'
			join postings imported on imported.transaction_id = p.transaction_id and imported.import_row_id is not null
			where not exists (
				select 1 from account_movement_matches m where m.outgoing_transaction_id = p.transaction_id
			) and not exists (
				select 1 from account_movement_matches m where m.incoming_transaction_id = p.transaction_id
			)
		)
		select target.id, target.owner_user_id, target.occurred_on, target.occurred_at, target.counterparty,
			target.description, target.memo, target.created_at,
			p.id, p.bucket_id, p.bucket_name, p.bucket_kind, p.amount, p.currency,
			p.stats_date, p.memo, p.import_row_id, p.mirror_id, p.created_at, p.updated_at, p.tags,
			m.match_id, m.side, m.counterpart_id, m.occurred_on, m.occurred_at, m.bucket_id,
			m.bucket_name, m.bucket_kind, m.amount, m.currency, u.side
		from target
		left join target_postings p on p.transaction_id = target.id
		left join matched_transfer m on m.transaction_id = target.id
		left join unmatched_transfer u on u.transaction_id = target.id
		order by p.created_at, p.id
	`, id, userID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var t Transaction
	var ps []Posting
	found := false
	for rows.Next() {
		found = true
		var (
			postingID, bucketID, bucketName, bucketKind, currency sql.NullString
			postingAmount                                         sql.NullInt64
			statsDate                                             sql.NullTime
			postingMemo, importRowID, mirrorID                    sql.NullString
			tags                                                  []byte
			matchID, matchSide, counterpartID                     sql.NullString
			counterpartOccurredOn, counterpartOccurredAt          sql.NullTime
			counterpartBucketID, counterpartBucketName            sql.NullString
			counterpartBucketKind, counterpartCurrency            sql.NullString
			counterpartAmount                                     sql.NullInt64
			unmatchedSide                                         sql.NullString
			createdAt, updatedAt                                  time.Time
		)
		if err = rows.Scan(
			&t.ID, &t.OwnerUserID, &t.OccurredOn, &t.OccurredAt, &t.Counterparty, &t.Description, &t.Memo, &t.CreatedAt,
			&postingID, &bucketID, &bucketName, &bucketKind, &postingAmount, &currency,
			&statsDate, &postingMemo, &importRowID, &mirrorID, &createdAt, &updatedAt, &tags,
			&matchID, &matchSide, &counterpartID, &counterpartOccurredOn, &counterpartOccurredAt, &counterpartBucketID,
			&counterpartBucketName, &counterpartBucketKind, &counterpartAmount, &counterpartCurrency, &unmatchedSide,
		); err != nil {
			return nil, nil, err
		}
		if postingID.Valid {
			p := Posting{
				ID:       postingID.String,
				BucketID: bucketID.String,
				Bucket: PostingBucket{
					ID: bucketID.String, Name: bucketName.String, Kind: BucketKind(bucketKind.String),
				},
				Amount: postingAmount.Int64, Currency: currency.String, Memo: postingMemo.String,
				Tags: []string{}, CreatedAt: createdAt, UpdatedAt: updatedAt,
			}
			if statsDate.Valid {
				p.StatsDate = &statsDate.Time
			}
			if importRowID.Valid {
				p.ImportRowID = &importRowID.String
			}
			if mirrorID.Valid {
				p.MirrorID = &mirrorID.String
			}
			if err = json.Unmarshal(tags, &p.Tags); err != nil {
				return nil, nil, err
			}
			ps = append(ps, p)
		}
		if matchID.Valid {
			t.Transfer = &TransferInfo{
				MatchID:               matchID.String,
				Side:                  matchSide.String,
				CounterpartID:         counterpartID.String,
				CounterpartOccurredOn: counterpartOccurredOn.Time,
				CounterpartBucket: &PostingBucket{
					ID: counterpartBucketID.String, Name: counterpartBucketName.String, Kind: BucketKind(counterpartBucketKind.String),
				},
				CounterpartAmount:   counterpartAmount.Int64,
				CounterpartCurrency: counterpartCurrency.String,
			}
			if counterpartOccurredAt.Valid {
				t.Transfer.CounterpartOccurredAt = &counterpartOccurredAt.Time
			}
		} else if unmatchedSide.Valid {
			t.Transfer = &TransferInfo{Side: unmatchedSide.String, Unmatched: true}
		}
	}
	if err = rows.Err(); err != nil {
		return nil, nil, err
	}
	if !found {
		return nil, nil, ErrNotFound
	}
	return &t, ps, nil
}

func ownedBuckets(ctx context.Context, tx *sql.Tx, owner string) (map[string]PostingBucket, error) {
	rows, err := tx.QueryContext(ctx, `
		select id, name, kind
		from buckets
		where owner_user_id = $1
		  and hidden = false
	`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]PostingBucket{}
	for rows.Next() {
		var b PostingBucket
		if err = rows.Scan(&b.ID, &b.Name, &b.Kind); err != nil {
			return nil, err
		}
		out[b.ID] = b
	}
	return out, rows.Err()
}

type SplitPosting struct {
	ID        string     `json:"id"`
	BucketID  string     `json:"bucket_id"`
	Amount    int64      `json:"amount"`
	Currency  string     `json:"currency"`
	StatsDate *time.Time `json:"stats_date"`
	Memo      string     `json:"memo"`
}

// SplitTransaction replaces only user-managed postings. Imported and system
// postings are always carried into the balance check unchanged.
func (d *Data) SplitTransaction(ctx context.Context, userID, transactionID string, expectedLatestPostingTimestamp time.Time, input []SplitPosting) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = loadOwnedTransaction(ctx, tx, userID, transactionID); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `
		select
			p.id, p.bucket_id, p.amount, p.currency, p.stats_date, p.memo,
			p.import_row_id, p.mirror_id, p.created_at, p.updated_at, b.hidden, b.kind
		from postings p
		join buckets b on b.id = p.bucket_id
		where p.transaction_id = $1
		for update of p
	`, transactionID)
	if err != nil {
		return err
	}
	var current []Posting
	mutable := map[string]bool{}
	transfer := false
	var latestPostingTimestamp time.Time
	for rows.Next() {
		var p Posting
		var hidden bool
		var kind BucketKind
		if err = rows.Scan(&p.ID, &p.BucketID, &p.Amount, &p.Currency, &p.StatsDate, &p.Memo, &p.ImportRowID, &p.MirrorID, &p.CreatedAt, &p.UpdatedAt, &hidden, &kind); err != nil {
			rows.Close()
			return err
		}
		current = append(current, p)
		postingTimestamp := p.UpdatedAt
		if p.CreatedAt.After(postingTimestamp) {
			postingTimestamp = p.CreatedAt
		}
		if postingTimestamp.After(latestPostingTimestamp) {
			latestPostingTimestamp = postingTimestamp
		}
		if !hidden && p.ImportRowID == nil {
			mutable[p.ID] = true
		}
		if kind == KindTransit {
			transfer = true
		}
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	if transfer {
		return ErrTransferSplit
	}
	if !latestPostingTimestamp.Equal(expectedLatestPostingTimestamp) {
		return ErrPostingConflict
	}
	buckets, err := ownedBuckets(ctx, tx, userID)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	final := make([]Posting, 0, len(current)+len(input))
	for _, p := range current {
		if !mutable[p.ID] {
			final = append(final, p)
		}
	}
	for i := range input {
		p := &input[i]
		if p.ID != "" {
			if !mutable[p.ID] || seen[p.ID] {
				return ErrInvalidPostings
			}
			seen[p.ID] = true
		} else {
			p.ID = NewPrivateID()
		}
		if _, ok := buckets[p.BucketID]; !ok {
			return ErrInvalidBucket
		}
		final = append(final, Posting{ID: p.ID, BucketID: p.BucketID, Amount: p.Amount, Currency: p.Currency, StatsDate: p.StatsDate, Memo: p.Memo})
	}
	if err = validatePostings(final); err != nil {
		return err
	}
	if err = validatePostingCurrencies(ctx, tx, final); err != nil {
		return err
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		with desired as materialized (
			select *
			from jsonb_to_recordset($3::jsonb) as x (
				id uuid, bucket_id uuid, amount bigint, currency text,
				stats_date date, memo text
			)
		), old as materialized (
			select p.*
			from postings p
			join buckets b on b.id = p.bucket_id
			where p.transaction_id = $2
			  and p.import_row_id is null
			  and b.hidden = false
		), changed as materialized (
			select o.*
			from old o
			join desired d on d.id = o.id
			where (o.bucket_id, o.amount, o.currency, o.stats_date, o.memo)
				is distinct from
				(d.bucket_id, d.amount, d.currency, d.stats_date, d.memo)
		), deleted_tags as materialized (
			delete from posting_tags
			where posting_id in (
				select id
				from old
				where id not in (select id from desired)
			)
			returning *
		), audited_tags as (
			insert into audit_logs
			select uuidv7(), $1, 'posting_tags', id, 'delete', to_jsonb(deleted_tags), now()
			from deleted_tags
		), audited_changes as (
			insert into audit_logs
			select uuidv7(), $1, 'postings', id, 'update', to_jsonb(changed), now()
			from changed
		), audited_deletes as (
			insert into audit_logs
			select uuidv7(), $1, 'postings', id, 'delete', to_jsonb(old), now()
			from old
			where id not in (select id from desired)
		), updated as (
			update postings p
			set bucket_id = d.bucket_id,
			    amount = d.amount,
			    currency = d.currency,
			    stats_date = d.stats_date,
			    memo = d.memo,
			    updated_at = clock_timestamp()
			from desired d
			where p.id = d.id
		), deleted as (
			delete from postings
			where id in (
				select id
				from old
				where id not in (select id from desired)
			)
		), inserted as (
			insert into postings (
				id, transaction_id, bucket_id, amount, currency, stats_date, memo, created_at, updated_at
			)
			select d.id, $2, d.bucket_id, d.amount, d.currency, d.stats_date, d.memo, clock_timestamp(), clock_timestamp()
			from desired d
			where d.id not in (select id from old)
			returning id
		)
		insert into audit_logs
		select uuidv7(), $1, 'postings', id, 'insert', null, now()
		from inserted
	`, userID, transactionID, payload)
	if err != nil {
		return err
	}
	return tx.Commit()
}
