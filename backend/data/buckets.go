package data

import (
	"context"
	"database/sql"
	"time"
)

type BucketKind string

const (
	KindAsset     BucketKind = "asset"
	KindLiability BucketKind = "liability"
	KindExpense   BucketKind = "expense"
	KindIncome    BucketKind = "income"
	KindPerson    BucketKind = "person"
	KindClearing  BucketKind = "clearing"
)

type Bucket struct {
	ID                string
	OwnerUserID       string
	Kind              BucketKind
	Name              string
	ParentID          *string
	CounterpartUserID *string
	Hidden            bool
	CreatedAt         time.Time
}

func insertBucketTx(ctx context.Context, tx *sql.Tx, b Bucket) error {
	if _, err := tx.ExecContext(ctx,
		`insert into buckets (id, owner_user_id, kind, name, parent_id, counterpart_user_id, hidden, created_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
		b.ID, b.OwnerUserID, b.Kind, b.Name, b.ParentID, b.CounterpartUserID, b.Hidden, b.CreatedAt.UTC()); err != nil {
		return err
	}
	return auditWrite(ctx, tx, b.OwnerUserID, "buckets", b.ID, "insert", nil)
}

func (d *Data) CreateBucket(ctx context.Context, b Bucket) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := insertBucketTx(ctx, tx, b); err != nil {
		return err
	}
	return tx.Commit()
}

func (d *Data) ListBuckets(ctx context.Context, ownerID string) ([]Bucket, error) {
	rows, err := d.db.QueryContext(ctx,
		`select id, owner_user_id, kind, name, parent_id, counterpart_user_id, hidden, created_at
		 from buckets where owner_user_id = $1 order by created_at`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var buckets []Bucket
	for rows.Next() {
		var b Bucket
		if err := rows.Scan(&b.ID, &b.OwnerUserID, &b.Kind, &b.Name, &b.ParentID, &b.CounterpartUserID, &b.Hidden, &b.CreatedAt); err != nil {
			return nil, err
		}
		buckets = append(buckets, b)
	}
	return buckets, rows.Err()
}
