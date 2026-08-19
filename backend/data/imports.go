package data

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"time"
)

var (
	ErrImportBucket   = errors.New("import target must be an asset or liability bucket you own")
	ErrNotDuplicate   = errors.New("import row is not a duplicate")
	ErrImportNotFound = errors.New("import batch not found")
)

type ImportBatch struct {
	ID          string
	UserID      string
	BucketID    string
	Source      string
	Filename    string
	CreatedAt   time.Time
	Status      string
	Error       *string
	Imported    int
	Duplicates  int
	ParseErrors json.RawMessage
}

type ImportRow struct {
	ID            string
	BatchID       string
	OccurredOn    time.Time
	OccurredAt    *time.Time
	Amount        int64
	Currency      string
	Counterparty  string
	Note          string
	DedupHash     string
	Occurrence    int
	Status        string
	TransactionID *string
	DuplicateOf   *string
	Target        *DupTarget
}

type DupTarget struct {
	OccurredOn    time.Time
	OccurredAt    *time.Time
	Amount        int64
	Currency      string
	Counterparty  string
	Note          string
	TransactionID *string
	BatchID       string
	CreatedAt     time.Time
}

// CreateImport stores an uploaded CSV and queues its import batch.
func (d *Data) CreateImport(ctx context.Context, userID, bucketID, source, filename string, r io.Reader) (*ImportBatch, error) {
	batch := ImportBatch{ID: NewPrivateID(), UserID: userID, BucketID: bucketID, Source: source, Filename: filename, CreatedAt: time.Now().UTC(), Status: "uploaded"}

	var tx *sql.Tx
	var err error
	externalFile := false
	if files, ok := d.files.(interface {
		PutTx(context.Context, *sql.Tx, string, io.Reader) error
	}); ok {
		tx, err = d.db.BeginTx(ctx, nil)
		if err != nil {
			return nil, err
		}
		if err = files.PutTx(ctx, tx, batch.ID, r); err != nil {
			tx.Rollback()
			return nil, err
		}
	} else {
		if err = d.files.Put(ctx, batch.ID, r); err != nil {
			return nil, err
		}
		externalFile = true
		tx, err = d.db.BeginTx(ctx, nil)
		if err != nil {
			if cleanupErr := d.files.Delete(ctx, batch.ID); cleanupErr != nil {
				slog.Error("cleaning up import file", "batch", batch.ID, "err", cleanupErr)
			}
			return nil, err
		}
	}
	committed := false
	defer func() {
		tx.Rollback()
		if externalFile && !committed {
			if cleanupErr := d.files.Delete(ctx, batch.ID); cleanupErr != nil {
				slog.Error("cleaning up import file", "batch", batch.ID, "err", cleanupErr)
			}
		}
	}()

	var inserted int
	err = tx.QueryRowContext(ctx, `
		with added as (
			insert into import_batches (
				id, user_id, bucket_id, source, filename, created_at, status
			)
			select $1, $2, $3, $4, $5, $6, 'uploaded'
			from buckets
			where id = $3
			  and owner_user_id = $2
			  and kind in ('asset', 'liability')
			  and hidden = false
			returning id
		), audited as (
			insert into audit_logs (
				id, actor_user_id, table_name, row_id, operation, before, created_at
			)
			select uuidv7(), $2, 'import_batches', id, 'insert', null, now()
			from added
		)
		select count(*)
		from added
	`, batch.ID, batch.UserID, batch.BucketID, batch.Source, batch.Filename, batch.CreatedAt).Scan(&inserted)
	if err != nil {
		return nil, err
	}
	if inserted == 0 {
		return nil, ErrImportBucket
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	committed = true

	d.kickImport()
	return &batch, nil
}

func (d *Data) kickImport() {
	select {
	case d.importKick <- struct{}{}:
	default:
	}
}
