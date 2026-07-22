package data

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

// auditWrite appends an append-only audit row. before is the row's prior state
// (nil for inserts). Every mutating query runs through this inside its own
// transaction so the audit trail covers all writes with no per-endpoint logic.
func auditWrite(ctx context.Context, tx *sql.Tx, actorID, table, rowID, operation string, before any) error {
	var beforeJSON []byte
	if before != nil {
		var err error
		beforeJSON, err = json.Marshal(before)
		if err != nil {
			return err
		}
	}

	_, err := tx.ExecContext(ctx, `
		insert into audit_logs (
			id, actor_user_id, table_name, row_id, operation, before, created_at
		)
		values ($1, $2, $3, $4, $5, $6, $7)
	`, NewPrivateID(), actorID, table, rowID, operation, beforeJSON, time.Now().UTC())
	return err
}
