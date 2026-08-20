package data

import (
	"context"
	"database/sql"
	"log/slog"
)

// ForceImport turns a duplicate row into a pending inbox row.
func (d *Data) ForceImport(ctx context.Context, userID, rowID string) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var status, hash string
	var linked bool
	err = tx.QueryRowContext(ctx, `
		select
			row.status,
			row.dedup_hash,
			exists (
				select 1
				from postings
				where import_row_id = row.id
			)
		from import_rows row
		join import_batches batch on batch.id = row.batch_id
		where row.id = $1
		  and batch.user_id = $2
		for update of row
	`, rowID, userID).Scan(&status, &hash, &linked)
	if err == sql.ErrNoRows {
		return ErrImportNotFound
	}
	if err != nil {
		return err
	}
	if status != "duplicate" {
		return ErrNotDuplicate
	}
	if linked {
		return ErrInvalidPostings
	}

	var occurrence int
	if err := tx.QueryRowContext(ctx, `
		select coalesce(max(occurrence) + 1, 0)
		from import_rows
		where dedup_hash = $1
		  and status <> 'duplicate'
	`, hash).Scan(&occurrence); err != nil {
		return err
	}

	before, err := loadImportRow(ctx, tx, rowID)
	if err != nil {
		return err
	}
	if err := auditWrite(ctx, tx, userID, "import_rows", rowID, "update", before); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		update import_rows
		set status = 'pending',
		    duplicate_of = null,
		    occurrence = $1
		where id = $2
	`, occurrence, rowID); err != nil {
		return err
	}
	return tx.Commit()
}

func (d *Data) DeleteImport(ctx context.Context, userID, batchID string) error {
	result, err := removeLedgerData(ctx, d.db, userID, removalTargets{
		importBatchIDs: []string{batchID},
	})
	if err != nil {
		return err
	}
	if result.removedImportBatches == 0 {
		return ErrImportNotFound
	}
	if err = d.files.Delete(ctx, batchID); err != nil {
		slog.Error("import blob delete failed", "batch", batchID, "err", err)
	}
	return nil
}

func loadImportRow(ctx context.Context, tx *sql.Tx, rowID string) (*ImportRow, error) {
	var row ImportRow
	err := tx.QueryRowContext(ctx, `
		select
			row.id,
			row.batch_id,
			row.occurred_on,
			row.occurred_at,
			row.amount,
			row.currency,
			row.counterparty,
			row.note,
			row.dedup_hash,
			row.occurrence,
			row.status,
			posting.transaction_id,
			row.duplicate_of
		from import_rows row
		left join postings posting on posting.import_row_id = row.id
		where row.id = $1
	`, rowID).Scan(
		&row.ID,
		&row.BatchID,
		&row.OccurredOn,
		&row.OccurredAt,
		&row.Amount,
		&row.Currency,
		&row.Counterparty,
		&row.Note,
		&row.DedupHash,
		&row.Occurrence,
		&row.Status,
		&row.TransactionID,
		&row.DuplicateOf,
	)
	if err != nil {
		return nil, err
	}
	return &row, nil
}
