package data

import (
	"context"
	"log/slog"
	"time"
)

const (
	importWorkers      = 4
	importMaxAttempts  = 5
	importBackoff      = 200 * time.Millisecond
	importPollFallback = 30 * time.Second
)

// StartImportWorkers launches the background pool that promotes uploaded import
// batches into real transactions. Boot recovery first re-queues any batch left
// `processing` by a crash (its file is still stored, so a retry is free). Workers
// then wake on a kick (sent after each upload) or a periodic poll, and claim
// whole batches via FOR UPDATE SKIP LOCKED with per-user round-robin fairness.
func (d *Data) StartImportWorkers(ctx context.Context) {
	if _, err := d.db.ExecContext(ctx,
		"update import_batches set status = 'uploaded' where status = 'processing'"); err != nil {
		slog.Error("import boot recovery failed", "err", err)
	}
	for i := 0; i < importWorkers; i++ {
		go d.importWorker(ctx)
	}
	d.kickImport()
}

func (d *Data) importWorker(ctx context.Context) {
	ticker := time.NewTicker(importPollFallback)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-d.importKick:
		case <-ticker.C:
		}
		d.drainImports(ctx)
	}
}

func (d *Data) drainImports(ctx context.Context) {
	for {
		did, err := d.promoteBatch(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			slog.Error("import promote failed, will retry on next poll", "err", err)
			return
		}
		if !did {
			return
		}
		d.kickImport() // pull peers in to parallelize a backlog of batches
	}
}
