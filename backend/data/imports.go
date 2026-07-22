package data

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
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
	Timezone    string
	CreatedAt   time.Time
	Status      string
	Imported    int
	Duplicates  int
	ParseErrors json.RawMessage
}

type ImportRow struct {
	ID             string
	BatchID        string
	Date           time.Time
	Amount         int64
	Currency       string
	RawDescription string
	Raw            json.RawMessage
	DedupHash      string
	Occurrence     int
	Status         string
	TransactionID  *string
	DuplicateOf    *string
	Target         *DupTarget
}

// DupTarget is the already-imported row a duplicate collided with, resolved via
// a self-join so the batch report can show it inline even across batches.
type DupTarget struct {
	Date           time.Time
	Amount         int64
	Currency       string
	RawDescription string
	TransactionID  *string
	BatchID        string
	CreatedAt      time.Time
}

// dedupHash fingerprints a row by content only. Two rows collide iff they are
// content-identical; occurrence (the k-th such row in a file) is tracked in a
// separate column, not baked in here. balance is the bank's running balance when
// the parser provides it — it makes otherwise-identical rows distinct, so a
// genuinely new transaction in a disjoint import no longer looks like a dupe.
func dedupHash(bucketID string, date time.Time, amount int64, currency, payee, message, balance string) string {
	fingerprint := strings.Join([]string{
		bucketID,
		date.Format(dateLayout),
		strconv.FormatInt(amount, 10),
		currency,
		strings.ToLower(payee) + strings.ToLower(message),
		balance,
	}, "\x00")
	sum := sha256.Sum256([]byte(fingerprint))
	return hex.EncodeToString(sum[:])
}

const dateLayout = "2006-01-02"

type RowSource interface {
	Next() bool
	Row() ParsedRow
	Err() error
}

// importParser is a RowSource that also reports per-row parse errors, so the
// worker can record them on the batch after staging.
type importParser interface {
	RowSource
	Errors() []RowError
}

// parserFor builds the parser for a source. loc is the timezone the batch was
// uploaded with; parsers interpret dates as midnight in it.
func parserFor(source string, r io.Reader, loc *time.Location, currencies map[string]int) (importParser, error) {
	switch source {
	case "nordea":
		return NewNordeaParser(r, loc, currencies), nil
	case "op":
		return NewOPParser(r, loc, currencies), nil
	case "revolut":
		return NewRevolutParser(r, loc, currencies), nil
	default:
		return nil, fmt.Errorf("unsupported import source %q", source)
	}
}

// CreateImport stores the uploaded file, then atomically validates the target,
// inserts the batch, and audits it. Postgres-backed files join the same database
// transaction. External stores are cleaned up if the database write fails.
func (d *Data) CreateImport(ctx context.Context, userID, bucketID, source, filename, timezone string, r io.Reader) (*ImportBatch, error) {
	batch := ImportBatch{ID: NewPrivateID(), UserID: userID, BucketID: bucketID, Source: source, Filename: filename, Timezone: timezone, CreatedAt: time.Now().UTC(), Status: "uploaded"}

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
				id, user_id, bucket_id, source, filename, timezone, created_at, status
			)
			select $1, $2, $3, $4, $5, $6, $7, 'uploaded'
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
	`, batch.ID, batch.UserID, batch.BucketID, batch.Source, batch.Filename, batch.Timezone, batch.CreatedAt).Scan(&inserted)
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

// stageCopySource adapts a RowSource into a CopyFromSource for the import_stage
// temp table, hashing each row's content one at a time so nothing is materialized.
// The hash is content-only; occurrence is assigned by a set-based pass afterward.
type stageCopySource struct {
	src      RowSource
	bucketID string
	cur      []any
	err      error
}

func (c *stageCopySource) Next() bool {
	if c.err != nil {
		return false
	}
	if !c.src.Next() {
		c.err = c.src.Err()
		return false
	}
	row := c.src.Row()
	hash := dedupHash(c.bucketID, row.Date, row.Amount, row.Currency, row.Payee, row.Message, row.Balance)
	c.cur = []any{NewPrivateID(), row.Date, row.Amount, row.Currency, row.RawDescription, row.Raw, hash}
	return true
}

func (c *stageCopySource) Values() ([]any, error) { return c.cur, nil }
func (c *stageCopySource) Err() error             { return c.err }

func (d *Data) kickImport() {
	select {
	case d.importKick <- struct{}{}:
	default:
	}
}

// stageOccurrenceSQL numbers the temp rows of one file: occurrence = the 0-based
// rank among content-identical rows. The column defaults to 0, so we only write
// the rare rows needing occ > 0 (the 2nd+ of a within-file content-dupe): a hash-
// aggregate finds the repeating fingerprints (near-zero by the no-within-file-dupes
// invariant), then the window ranks only those. occurrence makes genuine repeats
// distinct and lets overlapping re-exports dedup cross-batch.
const stageOccurrenceSQL = `
update import_stage r set occurrence = x.occ
from (
    select id, row_number() over (partition by dedup_hash order by id) - 1 as occ
    from import_stage
    where dedup_hash in (
        select dedup_hash from import_stage group by dedup_hash having count(*) > 1
    )
) x
where r.id = x.id and x.occ > 0`

// stageRowsSQL turns the temp table of one file into import_rows in a single
// set-based statement: each row lands as 'pending' (an inbox item) unless an
// already-present non-duplicate row shares its (dedup_hash, occurrence), in which
// case it lands as 'duplicate' pointing at the collision. No transaction is created
// here — categorizing a pending row later creates the ledger transaction. Within one
// file (dedup_hash, occurrence) is unique, so there is no within-batch winner logic;
// the partial unique index catches cross-batch races (the batch is retried, and the
// row then reads as a duplicate). Params: $1 batch. Returns (added, duplicates).
const stageRowsSQL = `
with stage as materialized (
    select s.id as stage_id, s.date, s.amount, s.currency, s.raw_description, s.raw,
           s.dedup_hash, s.occurrence, uuidv7() as row_id
    from import_stage s
),
existing as (
    select st.stage_id, i.id as e_id
    from stage st
    join import_rows i on i.dedup_hash = st.dedup_hash and i.occurrence = st.occurrence and i.status <> 'duplicate'
),
decided as materialized (
    select st.*, (e.e_id is null) as is_add, e.e_id as dup_of
    from stage st
    left join existing e on e.stage_id = st.stage_id
),
ins_pending as (
    insert into import_rows (id, batch_id, date, amount, currency, raw_description, raw, dedup_hash, occurrence, status)
    select row_id, $1, date, amount, currency, raw_description, raw, dedup_hash, occurrence, 'pending'
    from decided where is_add
),
ins_dup as (
    insert into import_rows (id, batch_id, date, amount, currency, raw_description, raw, dedup_hash, occurrence, status, duplicate_of)
    select row_id, $1, date, amount, currency, raw_description, raw, dedup_hash, occurrence, 'duplicate', dup_of
    from decided where not is_add
)
select count(*) filter (where is_add), count(*) filter (where not is_add) from decided`

// stageFile loads one batch's parsed rows into an unlogged temp table (no WAL),
// assigns occurrence, and runs stageRowsSQL — all on one pinned connection in a
// single transaction that drops the temp table on commit. Returns (added,
// duplicates).
func (d *Data) stageFile(ctx context.Context, batch ImportBatch, src RowSource) (int, int, error) {
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

		if _, err := tx.Exec(ctx, `
			create temp table import_stage (
				id uuid,
				date timestamptz,
				amount bigint,
				currency text,
				raw_description text,
				raw jsonb,
				dedup_hash text,
				occurrence int not null default 0
			) on commit drop
		`); err != nil {
			return err
		}

		cs := &stageCopySource{src: src, bucketID: batch.BucketID}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"import_stage"},
			[]string{"id", "date", "amount", "currency", "raw_description", "raw", "dedup_hash"}, cs); err != nil {
			return err
		}
		if cs.err != nil {
			return cs.err
		}

		if _, err := tx.Exec(ctx, stageOccurrenceSQL); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, stageRowsSQL, batch.ID).Scan(&added, &duplicates); err != nil {
			return err
		}
		return tx.Commit(ctx)
	})
	return added, duplicates, err
}

// claimBatchSQL claims the oldest uploaded batch belonging to the user with the
// fewest batches currently processing — round-robin fairness, so one user's
// backlog can't monopolize the pool. FOR UPDATE SKIP LOCKED lets workers claim in
// parallel; the claim flips status to processing in the same statement.
const claimBatchSQL = `
with claimed as (
    select b.id from import_batches b
    where b.status = 'uploaded'
    order by (select count(*) from import_batches p where p.user_id = b.user_id and p.status = 'processing'), b.created_at
    limit 1
    for update skip locked
)
update import_batches set status = 'processing'
where id in (select id from claimed)
returning id, user_id, bucket_id, source, filename, timezone`

func (d *Data) claimBatch(ctx context.Context) (ImportBatch, bool, error) {
	var b ImportBatch
	err := d.db.QueryRowContext(ctx, claimBatchSQL).Scan(&b.ID, &b.UserID, &b.BucketID, &b.Source, &b.Filename, &b.Timezone)
	if err == sql.ErrNoRows {
		return ImportBatch{}, false, nil
	}
	if err != nil {
		return ImportBatch{}, false, err
	}
	b.Status = "processing"
	return b, true, nil
}

// stageBatch claims one uploaded batch, stages its rows from its stored file, and
// finalizes status. Returns whether a batch was processed. Staging is retried in
// process: a cross-batch dedup race errors on the unique index, then succeeds on
// retry once the winner has committed (the losing rows become duplicates). A batch
// that never succeeds is marked failed; a done batch's blob is deleted.
func (d *Data) stageBatch(ctx context.Context) (bool, error) {
	batch, ok, err := d.claimBatch(ctx)
	if err != nil || !ok {
		return false, err
	}
	slog.Info("import: claimed batch", "batch", batch.ID, "user", batch.UserID, "file", batch.Filename)
	start := time.Now()

	added, duplicates, parseErrs, err := d.runStage(ctx, batch)
	if err != nil {
		slog.Error("import: staging failed", "batch", batch.ID, "took", time.Since(start), "err", err)
		d.failBatch(ctx, batch.ID, err)
		return true, nil
	}

	if err := d.finishBatch(ctx, batch.ID, parseErrs); err != nil {
		return true, err
	}
	if err := d.files.Delete(ctx, batch.ID); err != nil {
		slog.Error("import blob delete failed", "batch", batch.ID, "err", err)
	}
	slog.Info("import: batch done", "batch", batch.ID, "added", added,
		"duplicates", duplicates, "parse_errors", len(parseErrs), "took", time.Since(start))
	return true, nil
}

func (d *Data) runStage(ctx context.Context, batch ImportBatch) (int, int, []RowError, error) {
	loc, err := time.LoadLocation(batch.Timezone)
	if err != nil {
		return 0, 0, nil, fmt.Errorf("invalid batch timezone %q: %w", batch.Timezone, err)
	}
	currencies, err := d.currencyExponents(ctx)
	if err != nil {
		return 0, 0, nil, err
	}
	var lastErr error
	for attempt := 0; attempt < importMaxAttempts; attempt++ {
		blob, err := d.files.Open(ctx, batch.ID)
		if err != nil {
			return 0, 0, nil, err
		}
		parser, err := parserFor(batch.Source, blob, loc, currencies)
		if err != nil {
			blob.Close()
			return 0, 0, nil, err
		}
		added, duplicates, err := d.stageFile(ctx, batch, parser)
		blob.Close()
		if err == nil {
			return added, duplicates, parser.Errors(), nil
		}
		lastErr = err
		if ctx.Err() != nil {
			return 0, 0, nil, ctx.Err()
		}
		slog.Warn("import: staging attempt failed, retrying", "batch", batch.ID, "attempt", attempt+1, "err", err)
		time.Sleep(importBackoff)
	}
	return 0, 0, nil, lastErr
}

func (d *Data) finishBatch(ctx context.Context, batchID string, parseErrs []RowError) error {
	var pe any
	if len(parseErrs) > 0 {
		b, err := json.Marshal(parseErrs)
		if err != nil {
			return err
		}
		pe = b
	}
	_, err := d.db.ExecContext(ctx, `
		update import_batches
		set status = 'done',
		    parse_errors = $2
		where id = $1
	`, batchID, pe)
	return err
}

func (d *Data) failBatch(ctx context.Context, batchID string, cause error) {
	if _, err := d.db.ExecContext(ctx, `
		update import_batches
		set status = 'failed',
		    error = $2
		where id = $1
	`, batchID, cause.Error()); err != nil {
		slog.Error("marking import failed", "batch", batchID, "err", err)
	}
}

// ForceImport turns a duplicate row into a pending inbox row. The row keeps its
// content hash; it just claims the next free occurrence for that hash, so it
// coexists with the copy it collided with and future imports dedup against it too.
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
			r.status,
			r.dedup_hash,
			exists (
				select 1
				from postings
				where import_row_id = r.id
			)
		from import_rows r
		join import_batches b on b.id = r.batch_id
		where r.id = $1
		  and b.user_id = $2
		for update of r
	`, rowID, userID).
		Scan(&status, &hash, &linked)
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

// DeleteImport drops the batch, its rows and any transactions categorizing created,
// in one tx, then deletes the stored file. Before-images of every deleted row
// stream straight into audit_logs via to_jsonb — nothing is loaded into Go — and
// deleting the rows clears the dedup memory so a corrected re-import just works.
func (d *Data) DeleteImport(ctx context.Context, userID, batchID string) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var owner string
	err = tx.QueryRowContext(ctx, `
		select user_id
		from import_batches
		where id = $1
	`, batchID).Scan(&owner)
	if err == sql.ErrNoRows || (err == nil && owner != userID) {
		return ErrImportNotFound
	}
	if err != nil {
		return err
	}
	var txnIDs []string
	rows, err := tx.QueryContext(ctx, `
		select p.transaction_id
		from postings p
		join import_rows r on r.id = p.import_row_id
		where r.batch_id = $1
	`, batchID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		txnIDs = append(txnIDs, id)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	if len(txnIDs) > 0 {
		if _, err = removeTransactionsTx(ctx, tx, userID, txnIDs); err != nil {
			return err
		}
	}
	for _, table := range []string{"import_rows", "import_batches"} {
		where := "batch_id=$2"
		if table == "import_batches" {
			where = "id=$2"
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
		`, userID, batchID)
		if err != nil {
			return err
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if err = d.files.Delete(ctx, batchID); err != nil {
		slog.Error("import blob delete failed", "batch", batchID, "err", err)
	}
	return nil
}

func (d *Data) ListImports(ctx context.Context, userID string, cursorCreatedAt time.Time, cursorID string, limit int) ([]ImportBatch, error) {
	args := []any{userID}
	cursorClause := ""
	if cursorID != "" {
		cursorClause = "and (b.created_at, b.id) < ($2::timestamptz, $3::uuid)"
		args = append(args, cursorCreatedAt, cursorID)
	}

	rows, err := d.db.QueryContext(ctx,
		`select b.id, b.bucket_id, b.filename, b.created_at, b.status,
		        count(*) filter (where r.status <> 'duplicate'),
		        count(*) filter (where r.status = 'duplicate')
		 from import_batches b
		 left join import_rows r on r.batch_id = b.id
		 where b.user_id = $1 `+cursorClause+`
		 group by b.id
		 order by b.created_at desc, b.id desc
		 limit `+strconv.Itoa(limit), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var batches []ImportBatch
	for rows.Next() {
		var b ImportBatch
		if err := rows.Scan(&b.ID, &b.BucketID, &b.Filename, &b.CreatedAt, &b.Status, &b.Imported, &b.Duplicates); err != nil {
			return nil, err
		}
		batches = append(batches, b)
	}
	return batches, rows.Err()
}

// GetImportStatus returns the batch plus live staged/imported/duplicate counts in
// one query — the cheap shape the report page polls (never the rows themselves,
// which can number in the millions).
func (d *Data) GetImportStatus(ctx context.Context, userID, batchID string) (*ImportBatch, error) {
	var b ImportBatch
	err := d.db.QueryRowContext(ctx,
		`select b.id, b.bucket_id, b.filename, b.created_at, b.status, coalesce(b.parse_errors, '[]'::jsonb),
		        count(*) filter (where r.status <> 'duplicate'),
		        count(*) filter (where r.status = 'duplicate')
		 from import_batches b
		 left join import_rows r on r.batch_id = b.id
		 where b.id = $1 and b.user_id = $2
		 group by b.id`, batchID, userID).
		Scan(&b.ID, &b.BucketID, &b.Filename, &b.CreatedAt, &b.Status, &b.ParseErrors, &b.Imported, &b.Duplicates)
	if err == sql.ErrNoRows {
		return nil, ErrImportNotFound
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

func (d *Data) GetImport(ctx context.Context, userID, batchID string) (*ImportBatch, []ImportRow, error) {
	var b ImportBatch
	err := d.db.QueryRowContext(ctx, `
		select id, user_id, bucket_id, source, filename, created_at, status
		from import_batches
		where id = $1
		  and user_id = $2
	`, batchID, userID).Scan(&b.ID, &b.UserID, &b.BucketID, &b.Source, &b.Filename, &b.CreatedAt, &b.Status)
	if err == sql.ErrNoRows {
		return nil, nil, ErrImportNotFound
	}
	if err != nil {
		return nil, nil, err
	}

	rows, err := d.db.QueryContext(ctx,
		`select r.id, r.batch_id, r.date, r.amount, r.currency, r.raw_description, r.raw, r.status, rp.transaction_id, r.duplicate_of,
		        t.date, t.amount, t.currency, t.raw_description, tp.transaction_id, tb.id, tb.created_at
		 from import_rows r
		 left join postings rp on rp.import_row_id = r.id
		 left join import_rows t on t.id = r.duplicate_of
		 left join postings tp on tp.import_row_id = t.id
		 left join import_batches tb on tb.id = t.batch_id
		 where r.batch_id = $1 order by r.date, r.id`, batchID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var out []ImportRow
	for rows.Next() {
		var r ImportRow
		var (
			tDate, tCreated               sql.NullTime
			tAmount                       sql.NullInt64
			tCurrency, tRawDesc, tBatchID sql.NullString
			tTxnID                        sql.NullString
		)
		if err := rows.Scan(&r.ID, &r.BatchID, &r.Date, &r.Amount, &r.Currency, &r.RawDescription, &r.Raw, &r.Status, &r.TransactionID, &r.DuplicateOf,
			&tDate, &tAmount, &tCurrency, &tRawDesc, &tTxnID, &tBatchID, &tCreated); err != nil {
			return nil, nil, err
		}
		if tDate.Valid {
			r.Target = &DupTarget{Date: tDate.Time, Amount: tAmount.Int64, Currency: tCurrency.String, RawDescription: tRawDesc.String, BatchID: tBatchID.String, CreatedAt: tCreated.Time}
			if tTxnID.Valid {
				r.Target.TransactionID = &tTxnID.String
			}
		}
		out = append(out, r)
	}
	return &b, out, rows.Err()
}

// ListDuplicates returns one keyset page of a batch's duplicate rows (id order,
// so cursor is the last id seen; empty cursor starts at the beginning), each with
// its collision target inline via the same self-join GetImport uses. Server-side
// filtered to status='duplicate' and backed by a partial index — pages stay cheap
// even on million-row batches where duplicates are sparse.
func (d *Data) ListDuplicates(ctx context.Context, userID, batchID, cursor string, limit int) ([]ImportRow, error) {
	rows, err := d.db.QueryContext(ctx,
		`select r.id, r.batch_id, r.date, r.amount, r.currency, r.raw_description, r.raw, r.status, rp.transaction_id, r.duplicate_of,
		        t.date, t.amount, t.currency, t.raw_description, tp.transaction_id, tb.id, tb.created_at
		 from import_rows r
		 join import_batches b on b.id = r.batch_id
		 left join postings rp on rp.import_row_id = r.id
		 left join import_rows t on t.id = r.duplicate_of
		 left join postings tp on tp.import_row_id = t.id
		 left join import_batches tb on tb.id = t.batch_id
		 where r.batch_id = $1 and b.user_id = $2 and r.status = 'duplicate'
		   and ($3 = '' or r.id > $3::uuid)
		 order by r.id
		 limit $4`, batchID, userID, cursor, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ImportRow
	for rows.Next() {
		var r ImportRow
		var (
			tDate, tCreated               sql.NullTime
			tAmount                       sql.NullInt64
			tCurrency, tRawDesc, tBatchID sql.NullString
			tTxnID                        sql.NullString
		)
		if err := rows.Scan(&r.ID, &r.BatchID, &r.Date, &r.Amount, &r.Currency, &r.RawDescription, &r.Raw, &r.Status, &r.TransactionID, &r.DuplicateOf,
			&tDate, &tAmount, &tCurrency, &tRawDesc, &tTxnID, &tBatchID, &tCreated); err != nil {
			return nil, err
		}
		if tDate.Valid {
			r.Target = &DupTarget{Date: tDate.Time, Amount: tAmount.Int64, Currency: tCurrency.String, RawDescription: tRawDesc.String, BatchID: tBatchID.String, CreatedAt: tCreated.Time}
			if tTxnID.Valid {
				r.Target.TransactionID = &tTxnID.String
			}
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func loadImportRow(ctx context.Context, tx *sql.Tx, rowID string) (*ImportRow, error) {
	var r ImportRow
	err := tx.QueryRowContext(ctx, `
		select
			r.id, r.batch_id, r.date, r.amount, r.currency, r.raw_description,
			r.raw, r.dedup_hash, r.occurrence, r.status, p.transaction_id,
			r.duplicate_of
		from import_rows r
		left join postings p on p.import_row_id = r.id
		where r.id = $1
	`, rowID).
		Scan(&r.ID, &r.BatchID, &r.Date, &r.Amount, &r.Currency, &r.RawDescription, &r.Raw, &r.DedupHash, &r.Occurrence, &r.Status, &r.TransactionID, &r.DuplicateOf)
	if err != nil {
		return nil, err
	}
	return &r, nil
}
