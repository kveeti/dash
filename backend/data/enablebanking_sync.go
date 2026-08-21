package data

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/stdlib"
)

const EnableBankingSource = "enable_banking"

var (
	ErrBankSyncInProgress           = errors.New("bank account sync is already in progress")
	ErrBankSyncNotFound             = errors.New("bank sync job not found")
	ErrBankSyncRepeatedContinuation = errors.New("Enable Banking returned a repeated continuation key")
)

type EnableBankingSyncRequest struct {
	IntegrationID      string
	Bank               string
	BucketID           string
	AccountUID         string
	IdentificationHash string
}

type EnableBankingSyncJob struct {
	BatchID         string
	BucketID        string
	AccountUID      string
	DateFrom        time.Time
	ContinuationKey string
	NextSequence    int64
	FetchedAll      bool
	Attempts        int
}

func (d *Data) HasActiveEnableBankingSyncs(ctx context.Context, userID string) (bool, error) {
	var active bool
	err := d.db.QueryRowContext(ctx, `
		select exists (
			select 1
			from import_batches
			where user_id = $1
			  and source = $2
			  and status in ('queued', 'syncing')
		)
	`, userID, EnableBankingSource).Scan(&active)
	return active, err
}

// EnqueueEnableBankingSyncs creates every requested import batch and provider
// job atomically. No bank request is made on the caller's request path.
func (d *Data) EnqueueEnableBankingSyncs(ctx context.Context, userID string, requests []EnableBankingSyncRequest, dateTo time.Time) ([]string, error) {
	if len(requests) == 0 {
		return []string{}, nil
	}
	now := time.Now().UTC()
	dateToText := dateTo.UTC().Format(time.DateOnly)
	batchIDs := make([]string, len(requests))
	bucketIDs := make([]string, len(requests))
	accountUIDs := make([]string, len(requests))
	identificationHashes := make([]string, len(requests))
	integrationIDs := make([]string, len(requests))
	filenames := make([]string, len(requests))
	for i, request := range requests {
		batchIDs[i] = NewPrivateID()
		bucketIDs[i] = request.BucketID
		accountUIDs[i] = request.AccountUID
		identificationHashes[i] = request.IdentificationHash
		integrationIDs[i] = request.IntegrationID
		filenames[i] = request.Bank + " sync"
	}

	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var inserted int
	err = tx.QueryRowContext(ctx, `
		with requested(batch_id, bucket_id, account_uid, identification_hash, integration_id, filename) as (
			select *
			from unnest($3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::uuid[], $8::text[])
		), mapped_accounts as (
			select
				requested.batch_id,
				requested.bucket_id,
				requested.account_uid,
				requested.identification_hash,
				requested.integration_id,
				requested.filename,
				greatest(
					coalesce(
						(
							select max(previous.date_to) - 2
							from enable_banking_syncs previous
							where previous.integration_id = requested.integration_id
							  and previous.identification_hash = requested.identification_hash
							  and previous.completed_at is not null
							  and previous.completed_at >= integration.updated_at
						),
						($10::date - interval '2 years')::date
					),
					($10::date - interval '2 years')::date
				) as date_from
			from requested
			join buckets bucket on bucket.id = requested.bucket_id
			join bank_integrations integration on integration.id = requested.integration_id
			where bucket.owner_user_id = $1
			  and bucket.kind in ('asset', 'liability')
			  and not bucket.hidden
			  and bucket.active_bank_integration_id = integration.id
			  and integration.user_id = $1
			  and integration.provider = $2
			  and integration.deleted_at is null
			  and requested.account_uid <> ''
			  and requested.identification_hash <> ''
		), created_batches as (
			insert into import_batches (
				id, user_id, bucket_id, source, filename, created_at, status
			)
			select batch_id, $1, bucket_id, $2, filename, $9, 'queued'
			from mapped_accounts
			returning id
		), created_syncs as (
			insert into enable_banking_syncs (
				batch_id, integration_id, identification_hash, account_uid, date_from, date_to
			)
			select sync.batch_id, sync.integration_id, sync.identification_hash, sync.account_uid, sync.date_from, $10
			from mapped_accounts sync
			join created_batches batch on batch.id = sync.batch_id
			returning batch_id
		), audited as (
			insert into audit_logs (
				id, actor_user_id, table_name, row_id, operation, before, created_at
			)
			select uuidv7(), $1, 'import_batches', batch_id, 'insert', null, $9
			from created_syncs
		)
		select count(*) from created_syncs
	`, userID, EnableBankingSource, batchIDs, bucketIDs, accountUIDs, identificationHashes, integrationIDs, filenames, now, dateToText).Scan(&inserted)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrBankSyncInProgress
		}
		return nil, err
	}
	if inserted != len(requests) {
		return nil, ErrIntegrationAccount
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return batchIDs, nil
}

func (d *Data) ClaimEnableBankingSync(ctx context.Context) (EnableBankingSyncJob, bool, error) {
	var job EnableBankingSyncJob
	err := d.db.QueryRowContext(ctx, `
		with ready_job as (
			select sync.batch_id
			from enable_banking_syncs sync
			join import_batches batch on batch.id = sync.batch_id
			where batch.status = 'queued'
			  and sync.completed_at is null
			  and sync.next_attempt_at <= now()
			order by
				(
					select count(*)
					from import_batches active
					where active.user_id = batch.user_id
					  and active.status = 'syncing'
				),
				batch.created_at
			limit 1
			for update of batch skip locked
		), claimed_batch as (
			update import_batches batch
			set status = 'syncing', error = null
			where batch.id in (select batch_id from ready_job)
			returning batch.id, batch.bucket_id
		)
		select
			batch.id,
			batch.bucket_id,
			sync.account_uid,
			sync.date_from,
			sync.continuation_key,
			sync.next_sequence,
			sync.fetched_all,
			sync.attempts
		from claimed_batch batch
		join enable_banking_syncs sync on sync.batch_id = batch.id
	`).Scan(
		&job.BatchID,
		&job.BucketID,
		&job.AccountUID,
		&job.DateFrom,
		&job.ContinuationKey,
		&job.NextSequence,
		&job.FetchedAll,
		&job.Attempts,
	)
	if err == sql.ErrNoRows {
		return EnableBankingSyncJob{}, false, nil
	}
	if err != nil {
		return EnableBankingSyncJob{}, false, err
	}
	return job, true, nil
}

func (d *Data) RecoverEnableBankingSyncs(ctx context.Context) error {
	_, err := d.db.ExecContext(ctx, `
		update import_batches set status='queued'
		where status='syncing' and source=$1
	`, EnableBankingSource)
	return err
}

// StageEnableBankingPage commits normalized rows and the next continuation key
// together, making one complete provider page the retry unit.
func (d *Data) StageEnableBankingPage(ctx context.Context, job EnableBankingSyncJob, rows []ParsedRow, rowErrors []RowError, nextContinuation string, fetchedAll bool) error {
	conn, err := d.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	return conn.Raw(func(driverConn any) error {
		pgxConn := driverConn.(*stdlib.Conn).Conn()
		tx, err := pgxConn.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)

		var continuation string
		var seenContinuations []string
		var sequence int64
		var dateFrom time.Time
		err = tx.QueryRow(ctx, `
			select sync.continuation_key, sync.seen_continuation_keys, sync.next_sequence, sync.date_from
			from enable_banking_syncs sync
			join import_batches batch on batch.id = sync.batch_id
			where sync.batch_id = $1
			  and sync.completed_at is null
			  and batch.status = 'syncing'
			for update of sync, batch
		`, job.BatchID).Scan(&continuation, &seenContinuations, &sequence, &dateFrom)
		if err == pgx.ErrNoRows {
			return ErrBankSyncNotFound
		}
		if err != nil {
			return err
		}
		if continuation != job.ContinuationKey || sequence != job.NextSequence || !dateFrom.Equal(job.DateFrom) {
			return fmt.Errorf("bank sync page changed while processing")
		}
		if nextContinuation != "" {
			for _, seen := range seenContinuations {
				if seen == nextContinuation {
					return ErrBankSyncRepeatedContinuation
				}
			}
		}

		values := make([][]any, len(rows))
		for i, row := range rows {
			values[i] = []any{
				NewPrivateID(), job.BatchID, sequence + int64(i), row.OccurredOn, row.OccurredAt,
				row.Amount, row.Currency, row.Counterparty, row.Note,
				dedupHash(job.BucketID, row.OccurredOn, row.Amount, row.Currency, row.Counterparty),
			}
		}
		if len(values) > 0 {
			if _, err := tx.CopyFrom(ctx, pgx.Identifier{"import_staged_rows"},
				[]string{"id", "batch_id", "sequence", "occurred_on", "occurred_at", "amount", "currency", "counterparty", "note", "dedup_hash"},
				pgx.CopyFromRows(values)); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `
			update enable_banking_syncs
			set continuation_key = $2,
			    seen_continuation_keys = case
			        when $2 = '' then seen_continuation_keys
			        else array_append(seen_continuation_keys, $2)
			    end,
			    next_sequence = $3,
			    fetched_all = $4,
			    attempts = 0,
			    next_attempt_at = now()
			where batch_id = $1
		`, job.BatchID, nextContinuation, sequence+int64(len(rows)), fetchedAll); err != nil {
			return err
		}
		if len(rowErrors) > 0 {
			encodedErrors, err := json.Marshal(rowErrors)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				update import_batches
				set parse_errors = coalesce(parse_errors, '[]'::jsonb) || $2::jsonb
				where id = $1
			`, job.BatchID, string(encodedErrors)); err != nil {
				return err
			}
		}
		return tx.Commit(ctx)
	})
}

// FinalizeEnableBankingSync runs the existing whole-batch occurrence and dedupe
// logic over durable provider staging rows.
func (d *Data) FinalizeEnableBankingSync(ctx context.Context, batchID string) (int, int, error) {
	conn, err := d.db.Conn(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer conn.Close()

	var added, duplicates int
	err = conn.Raw(func(driverConn any) error {
		pgxConn := driverConn.(*stdlib.Conn).Conn()
		tx, err := pgxConn.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)

		var fetchedAll bool
		err = tx.QueryRow(ctx, `
			select sync.fetched_all
			from enable_banking_syncs sync
			join import_batches batch on batch.id = sync.batch_id
			where sync.batch_id = $1
			  and sync.completed_at is null
			  and batch.status = 'syncing'
			for update of sync, batch
		`, batchID).Scan(&fetchedAll)
		if err == pgx.ErrNoRows {
			return ErrBankSyncNotFound
		}
		if err != nil {
			return err
		}
		if !fetchedAll {
			return fmt.Errorf("bank sync fetch is not complete")
		}

		added, duplicates, err = finalizeStagedRows(ctx, tx, batchID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			update import_batches
			set status = 'done', error = null
			where id = $1
		`, batchID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			update enable_banking_syncs
			set completed_at = now()
			where batch_id = $1
		`, batchID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	})
	return added, duplicates, err
}

func (d *Data) RetryEnableBankingSync(ctx context.Context, batchID string, nextAttempt time.Time, cause error) error {
	result, err := d.db.ExecContext(ctx, `
		with retried_job as (
			update enable_banking_syncs
			set attempts = attempts + 1,
			    next_attempt_at = $2
			where batch_id = $1
			returning batch_id
		)
		update import_batches
		set status = 'queued', error = $3
		where id in (select batch_id from retried_job)
	`, batchID, nextAttempt, cause.Error())
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return ErrBankSyncNotFound
	}
	return nil
}

func (d *Data) FailEnableBankingSync(ctx context.Context, batchID string, cause error) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		update import_batches
		set status = 'failed', error = $2
		where id = $1
	`, batchID, cause.Error()); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `delete from import_staged_rows where batch_id = $1`, batchID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `delete from enable_banking_syncs where batch_id = $1`, batchID); err != nil {
		return err
	}
	return tx.Commit()
}
