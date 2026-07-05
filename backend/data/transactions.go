package data

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"
)

// visiblePostings is the single predicate every balance/stats/list read filters
// on ($1 = user id): a posting counts iff it sits on a bucket the user owns. The
// mirror counting rule and shared buckets extend this one place, never with
// per-endpoint where clauses.
const visiblePostings = "p.bucket_id in (select id from buckets where owner_user_id = $1)"

var (
	ErrUnbalanced      = errors.New("transaction does not balance: each currency must net to zero")
	ErrInvalidPostings = errors.New("transaction needs at least two postings with nonzero amounts")
	ErrInvalidBucket   = errors.New("posting references a bucket you do not own")
	ErrNotFound        = errors.New("transaction not found")
)

type Transaction struct {
	ID           string
	OwnerUserID  string
	Date         time.Time
	Counterparty string
	Description  string
	CreatedAt    time.Time
}

type Posting struct {
	ID       string
	BucketID string
	Amount   int64
	Currency string
	MirrorID *string
}

// CreateTransaction validates the balance and bucket-ownership invariants and,
// if they hold, inserts the transaction with its postings in one transaction.
func (d *Data) CreateTransaction(ctx context.Context, txn Transaction, postings []Posting) (*Transaction, []Posting, error) {
	if err := validatePostings(postings); err != nil {
		return nil, nil, err
	}

	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()

	owned, err := ownedBucketIDs(ctx, tx, txn.OwnerUserID)
	if err != nil {
		return nil, nil, err
	}
	for _, p := range postings {
		if !owned[p.BucketID] {
			return nil, nil, ErrInvalidBucket
		}
	}

	if err := insertTransactionTx(ctx, tx, &txn, postings); err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	return &txn, postings, nil
}

// insertTransactionTx writes a transaction and its postings (with audit rows)
// inside an existing tx. The caller owns validation and bucket-ownership checks.
func insertTransactionTx(ctx context.Context, tx *sql.Tx, txn *Transaction, postings []Posting) error {
	txn.CreatedAt = time.Now().UTC()
	if _, err := tx.ExecContext(ctx,
		"insert into transactions (id, owner_user_id, date, counterparty, description, created_at) values ($1, $2, $3, $4, $5, $6)",
		txn.ID, txn.OwnerUserID, txn.Date, txn.Counterparty, txn.Description, txn.CreatedAt); err != nil {
		return err
	}
	if err := auditWrite(ctx, tx, txn.OwnerUserID, "transactions", txn.ID, "insert", nil); err != nil {
		return err
	}

	now := time.Now().UTC()
	for i := range postings {
		postings[i].ID = NewPrivateID()
		p := postings[i]
		if _, err := tx.ExecContext(ctx,
			"insert into postings (id, transaction_id, bucket_id, amount, currency, mirror_id, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
			p.ID, txn.ID, p.BucketID, p.Amount, p.Currency, p.MirrorID, now); err != nil {
			return err
		}
		if err := auditWrite(ctx, tx, txn.OwnerUserID, "postings", p.ID, "insert", nil); err != nil {
			return err
		}
	}
	return nil
}

// UpdateTransaction replaces a transaction's fields and postings in place after
// re-checking the same invariants as create. Mirror-aware editing (proposals)
// lands with sharing; for now this is a plain owner-only replace.
func (d *Data) UpdateTransaction(ctx context.Context, userID, txnID string, date time.Time, counterparty, description string, postings []Posting) (*Transaction, []Posting, error) {
	if err := validatePostings(postings); err != nil {
		return nil, nil, err
	}

	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()

	old, err := loadOwnedTransaction(ctx, tx, userID, txnID)
	if err != nil {
		return nil, nil, err
	}

	owned, err := ownedBucketIDs(ctx, tx, userID)
	if err != nil {
		return nil, nil, err
	}
	for _, p := range postings {
		if !owned[p.BucketID] {
			return nil, nil, ErrInvalidBucket
		}
	}

	if err := auditWrite(ctx, tx, userID, "transactions", txnID, "update", old); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx,
		"update transactions set date = $1, counterparty = $2, description = $3 where id = $4", date, counterparty, description, txnID); err != nil {
		return nil, nil, err
	}

	if err := deletePostings(ctx, tx, userID, txnID); err != nil {
		return nil, nil, err
	}

	now := time.Now().UTC()
	for i := range postings {
		postings[i].ID = NewPrivateID()
		p := postings[i]
		if _, err := tx.ExecContext(ctx,
			"insert into postings (id, transaction_id, bucket_id, amount, currency, mirror_id, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
			p.ID, txnID, p.BucketID, p.Amount, p.Currency, p.MirrorID, now); err != nil {
			return nil, nil, err
		}
		if err := auditWrite(ctx, tx, userID, "postings", p.ID, "insert", nil); err != nil {
			return nil, nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	updated := Transaction{ID: txnID, OwnerUserID: userID, Date: date, Counterparty: counterparty, Description: description, CreatedAt: old.CreatedAt}
	return &updated, postings, nil
}

// DeleteTransaction removes a transaction and its postings, recording a
// before-image of every deleted row in the audit log.
func (d *Data) DeleteTransaction(ctx context.Context, userID, txnID string) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	old, err := loadOwnedTransaction(ctx, tx, userID, txnID)
	if err != nil {
		return err
	}

	if err := deletePostings(ctx, tx, userID, txnID); err != nil {
		return err
	}
	if err := auditWrite(ctx, tx, userID, "transactions", txnID, "delete", old); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "delete from transactions where id = $1", txnID); err != nil {
		return err
	}

	return tx.Commit()
}

func loadOwnedTransaction(ctx context.Context, tx *sql.Tx, userID, txnID string) (*Transaction, error) {
	var t Transaction
	err := tx.QueryRowContext(ctx,
		"select id, owner_user_id, date, counterparty, description, created_at from transactions where id = $1 and owner_user_id = $2",
		txnID, userID).Scan(&t.ID, &t.OwnerUserID, &t.Date, &t.Counterparty, &t.Description, &t.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// deletePostings audits a before-image of each posting then deletes them.
func deletePostings(ctx context.Context, tx *sql.Tx, userID, txnID string) error {
	rows, err := tx.QueryContext(ctx,
		"select id, bucket_id, amount, currency, mirror_id from postings where transaction_id = $1", txnID)
	if err != nil {
		return err
	}
	defer rows.Close()

	var postings []Posting
	for rows.Next() {
		var p Posting
		if err := rows.Scan(&p.ID, &p.BucketID, &p.Amount, &p.Currency, &p.MirrorID); err != nil {
			return err
		}
		postings = append(postings, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, p := range postings {
		if err := auditWrite(ctx, tx, userID, "postings", p.ID, "delete", p); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, "delete from postings where transaction_id = $1", txnID)
	return err
}

func validatePostings(postings []Posting) error {
	if len(postings) < 2 {
		return ErrInvalidPostings
	}
	perCurrency := map[string]int64{}
	for _, p := range postings {
		if p.Amount == 0 || p.Currency == "" {
			return ErrInvalidPostings
		}
		perCurrency[p.Currency] += p.Amount
	}
	for _, sum := range perCurrency {
		if sum != 0 {
			return ErrUnbalanced
		}
	}
	return nil
}

func ownedBucketIDs(ctx context.Context, tx *sql.Tx, ownerID string) (map[string]bool, error) {
	rows, err := tx.QueryContext(ctx, "select id from buckets where owner_user_id = $1", ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	owned := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		owned[id] = true
	}
	return owned, rows.Err()
}

const TransactionPageSize = 100

// ListTransactions returns one keyset page of visible transactions ordered
// (date desc, id desc). cursorID == "" starts from the top; otherwise rows
// strictly before (cursorDate, cursorID) are returned. Transactions are paged
// first (page CTE) so a limit never splits a transaction's postings, and both
// the page selection and the posting join filter through visiblePostings so no
// non-visible leg leaks.
func (d *Data) ListTransactions(ctx context.Context, userID string, cursorDate time.Time, cursorID string) ([]Transaction, map[string][]Posting, error) {
	args := []any{userID}
	cursorClause := ""
	if cursorID != "" {
		cursorClause = "and (t.date, t.id) < ($2::date, $3::uuid)"
		args = append(args, cursorDate, cursorID)
	}
	rows, err := d.db.QueryContext(ctx,
		`with page as (
			select distinct t.id, t.owner_user_id, t.date, t.counterparty, t.description, t.created_at
			from transactions t
			join postings p on p.transaction_id = t.id
			where `+visiblePostings+` `+cursorClause+`
			order by t.date desc, t.id desc
			limit `+strconv.Itoa(TransactionPageSize)+`
		)
		select page.id, page.owner_user_id, page.date, page.counterparty, page.description, page.created_at,
		       p.id, p.bucket_id, p.amount, p.currency, p.mirror_id
		from page
		join postings p on p.transaction_id = page.id
		where `+visiblePostings+`
		order by page.date desc, page.id desc, p.created_at`, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var txns []Transaction
	seen := map[string]bool{}
	postings := map[string][]Posting{}
	for rows.Next() {
		var t Transaction
		var p Posting
		var txnID string
		if err := rows.Scan(&t.ID, &t.OwnerUserID, &t.Date, &t.Counterparty, &t.Description, &t.CreatedAt,
			&p.ID, &p.BucketID, &p.Amount, &p.Currency, &p.MirrorID); err != nil {
			return nil, nil, err
		}
		txnID = t.ID
		if !seen[txnID] {
			seen[txnID] = true
			txns = append(txns, t)
		}
		postings[txnID] = append(postings[txnID], p)
	}
	return txns, postings, rows.Err()
}
