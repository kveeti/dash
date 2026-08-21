package data

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
)

// ForceImport turns a duplicate row into a pending inbox row.
func (d *Data) ForceImport(ctx context.Context, userID, rowID string) error {
	var status string
	var linked, updated bool
	err := d.db.QueryRowContext(ctx, `
		with target as materialized (
			select
				row.*,
				exists (
					select 1
					from postings
					where import_row_id = row.id
				) as linked
			from import_rows row
			join import_batches batch on batch.id = row.batch_id
			where row.id = $1
			  and batch.user_id = $2
			for update of row
		), next_occurrence as (
			select coalesce(max(existing.occurrence) + 1, 0) as occurrence
			from target
			left join import_rows existing
			  on existing.dedup_hash = target.dedup_hash
			 and existing.status <> 'duplicate'
		), audited as (
			insert into audit_logs (
				id, actor_user_id, table_name, row_id, operation, before, created_at
			)
			select
				uuidv7(), $2, 'import_rows', id, 'update',
				to_jsonb(target) - 'linked', now()
			from target
			where status = 'duplicate'
			  and not linked
			returning row_id
		), changed as (
			update import_rows row
			set status = 'pending',
			    duplicate_of = null,
			    occurrence = next_occurrence.occurrence
			from target, next_occurrence, audited
			where row.id = target.id
			  and audited.row_id = target.id
			returning row.id
		)
		select
			target.status,
			target.linked,
			exists (select 1 from changed)
		from target
	`, rowID, userID).Scan(&status, &linked, &updated)
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
	if !updated {
		return fmt.Errorf("force import update failed")
	}
	return nil
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
