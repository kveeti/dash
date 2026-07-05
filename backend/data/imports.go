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
// worker can record them on the batch after promotion.
type importParser interface {
	RowSource
	Errors() []RowError
}

func parserFor(source string, r io.Reader) (importParser, error) {
	switch source {
	case "nordea":
		return NewNordeaParser(r), nil
	default:
		return nil, fmt.Errorf("unsupported import source %q", source)
	}
}

// CreateImport durably stores the uploaded file as the batch's work item, then
// records the batch pointer. Blob-before-pointer: the blob lands first, so a batch
// row always has its file; the only failure mode is an orphan blob if the pointer
// insert fails (swept later). All parsing and promotion happen in the background
// worker (see promoteBatch). Returns the batch.
func (d *Data) CreateImport(ctx context.Context, userID, bucketID, source, filename string, r io.Reader) (*ImportBatch, error) {
	batch := ImportBatch{ID: NewPrivateID(), UserID: userID, BucketID: bucketID, Source: source, Filename: filename, CreatedAt: time.Now().UTC(), Status: "uploaded"}

	if err := d.files.Put(ctx, batch.ID, r); err != nil {
		return nil, err
	}

	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		"insert into import_batches (id, user_id, bucket_id, source, filename, created_at, status) values ($1, $2, $3, $4, $5, $6, 'uploaded')",
		batch.ID, batch.UserID, batch.BucketID, batch.Source, batch.Filename, batch.CreatedAt); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx,
		"insert into audit_logs (id, actor_user_id, table_name, row_id, operation, before, created_at) values (uuidv7(), $1, 'import_batches', $2, 'insert', null, now())",
		userID, batch.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	d.kickImport()
	return &batch, nil
}

// ValidateImportBucket reports whether the target bucket is one the user owns and
// can import into (asset or liability), so the ingest handler can reject before
// buffering the upload.
func (d *Data) ValidateImportBucket(ctx context.Context, userID, bucketID string) error {
	var kind BucketKind
	err := d.db.QueryRowContext(ctx, "select kind from buckets where id = $1 and owner_user_id = $2", bucketID, userID).Scan(&kind)
	if err == sql.ErrNoRows {
		return ErrImportBucket
	}
	if err != nil {
		return err
	}
	if kind != KindAsset && kind != KindLiability {
		return ErrImportBucket
	}
	return nil
}

// stageCopySource adapts a RowSource into a CopyFromSource for the promote_stage
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
update promote_stage r set occurrence = x.occ
from (
    select id, row_number() over (partition by dedup_hash order by id) - 1 as occ
    from promote_stage
    where dedup_hash in (
        select dedup_hash from promote_stage group by dedup_hash having count(*) > 1
    )
) x
where r.id = x.id and x.occ > 0`

// promoteStageSQL turns the temp table of one file into ledger rows in a single
// set-based statement: each row is imported unless an already-imported row shares
// its (dedup_hash, occurrence). Imported rows get a transaction + both posting legs
// (counter-leg on the hidden uncategorized bucket) and an import_rows record;
// duplicates get an import_rows record pointing at the collision. Within one file
// (dedup_hash, occurrence) is unique, so there is no within-batch winner logic; the
// partial unique index catches cross-batch races (the batch is retried, and the row
// then reads as a duplicate). Params: $1 user, $2 bucket, $3 batch. Returns
// (imported, duplicates).
const promoteStageSQL = `
with stage as materialized (
    select s.id as stage_id, s.date, s.amount, s.currency, s.raw_description, s.raw,
           s.dedup_hash, s.occurrence,
           s.raw->>'payee' as payee, s.raw->>'message' as message,
           uuidv7() as row_id, uuidv7() as txn_id, uuidv7() as p1_id, uuidv7() as p2_id
    from promote_stage s
),
existing as (
    select st.stage_id, i.id as e_id
    from stage st
    join import_rows i on i.dedup_hash = st.dedup_hash and i.occurrence = st.occurrence and i.status = 'imported'
),
decided as materialized (
    select st.*, (e.e_id is null) as is_import, e.e_id as dup_of
    from stage st
    left join existing e on e.stage_id = st.stage_id
),
unc as (
    select id from buckets where owner_user_id = $1 and kind = 'expense' and hidden = true limit 1
),
ins_txn as (
    insert into transactions (id, owner_user_id, date, counterparty, description, created_at)
    select txn_id, $1, date, payee, message, now() from decided where is_import
),
ins_post as (
    insert into postings (id, transaction_id, bucket_id, amount, currency, mirror_id, created_at)
    select p1_id, txn_id, $2, amount, currency, null::uuid, now() from decided where is_import
    union all
    select p2_id, txn_id, (select id from unc), -amount, currency, null::uuid, now() from decided where is_import
),
ins_imported as (
    insert into import_rows (id, batch_id, date, amount, currency, raw_description, raw, dedup_hash, occurrence, status, transaction_id)
    select row_id, $3, date, amount, currency, raw_description, raw, dedup_hash, occurrence, 'imported', txn_id
    from decided where is_import
),
ins_dup as (
    insert into import_rows (id, batch_id, date, amount, currency, raw_description, raw, dedup_hash, occurrence, status, duplicate_of)
    select row_id, $3, date, amount, currency, raw_description, raw, dedup_hash, occurrence, 'duplicate', dup_of
    from decided where not is_import
)
select count(*) filter (where is_import), count(*) filter (where not is_import) from decided`

// promote loads one batch's parsed rows into an unlogged temp table (no WAL),
// assigns occurrence, and runs promoteStageSQL — all on one pinned connection in a
// single transaction that drops the temp table on commit. Returns (imported,
// duplicates).
func (d *Data) promote(ctx context.Context, batch ImportBatch, src RowSource) (int, int, error) {
	conn, err := d.db.Conn(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer conn.Close()

	var imported, duplicates int
	err = conn.Raw(func(driverConn any) error {
		pgxConn := driverConn.(*stdlib.Conn).Conn()
		tx, err := pgxConn.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)

		if _, err := tx.Exec(ctx, `create temp table promote_stage (
			id uuid, date date, amount bigint, currency text,
			raw_description text, raw jsonb, dedup_hash text, occurrence int not null default 0
		) on commit drop`); err != nil {
			return err
		}

		cs := &stageCopySource{src: src, bucketID: batch.BucketID}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"promote_stage"},
			[]string{"id", "date", "amount", "currency", "raw_description", "raw", "dedup_hash"}, cs); err != nil {
			return err
		}
		if cs.err != nil {
			return cs.err
		}

		if _, err := tx.Exec(ctx, stageOccurrenceSQL); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, promoteStageSQL, batch.UserID, batch.BucketID, batch.ID).Scan(&imported, &duplicates); err != nil {
			return err
		}
		return tx.Commit(ctx)
	})
	return imported, duplicates, err
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
returning id, user_id, bucket_id, source, filename`

func (d *Data) claimBatch(ctx context.Context) (ImportBatch, bool, error) {
	var b ImportBatch
	err := d.db.QueryRowContext(ctx, claimBatchSQL).Scan(&b.ID, &b.UserID, &b.BucketID, &b.Source, &b.Filename)
	if err == sql.ErrNoRows {
		return ImportBatch{}, false, nil
	}
	if err != nil {
		return ImportBatch{}, false, err
	}
	b.Status = "processing"
	return b, true, nil
}

// promoteBatch claims one uploaded batch, promotes it from its stored file, and
// finalizes status. Returns whether a batch was processed. Promote is retried in
// process: a cross-batch dedup race errors on the unique index, then succeeds on
// retry once the winner has committed (the losing rows become duplicates). A batch
// that never succeeds is marked failed; a done batch's blob is deleted.
func (d *Data) promoteBatch(ctx context.Context) (bool, error) {
	batch, ok, err := d.claimBatch(ctx)
	if err != nil || !ok {
		return false, err
	}
	slog.Info("import: claimed batch", "batch", batch.ID, "user", batch.UserID, "file", batch.Filename)
	start := time.Now()

	imported, duplicates, parseErrs, err := d.runPromote(ctx, batch)
	if err != nil {
		slog.Error("import: promote failed", "batch", batch.ID, "took", time.Since(start), "err", err)
		d.failBatch(ctx, batch.ID, err)
		return true, nil
	}

	if err := d.finishBatch(ctx, batch.ID, parseErrs); err != nil {
		return true, err
	}
	if err := d.files.Delete(ctx, batch.ID); err != nil {
		slog.Error("import blob delete failed", "batch", batch.ID, "err", err)
	}
	slog.Info("import: batch done", "batch", batch.ID, "imported", imported,
		"duplicates", duplicates, "parse_errors", len(parseErrs), "took", time.Since(start))
	return true, nil
}

func (d *Data) runPromote(ctx context.Context, batch ImportBatch) (int, int, []RowError, error) {
	var lastErr error
	for attempt := 0; attempt < importMaxAttempts; attempt++ {
		blob, err := d.files.Open(ctx, batch.ID)
		if err != nil {
			return 0, 0, nil, err
		}
		parser, err := parserFor(batch.Source, blob)
		if err != nil {
			blob.Close()
			return 0, 0, nil, err
		}
		imported, duplicates, err := d.promote(ctx, batch, parser)
		blob.Close()
		if err == nil {
			return imported, duplicates, parser.Errors(), nil
		}
		lastErr = err
		if ctx.Err() != nil {
			return 0, 0, nil, ctx.Err()
		}
		slog.Warn("import: promote attempt failed, retrying", "batch", batch.ID, "attempt", attempt+1, "err", err)
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
	_, err := d.db.ExecContext(ctx, "update import_batches set status = 'done', parse_errors = $2 where id = $1", batchID, pe)
	return err
}

func (d *Data) failBatch(ctx context.Context, batchID string, cause error) {
	if _, err := d.db.ExecContext(ctx, "update import_batches set status = 'failed', error = $2 where id = $1", batchID, cause.Error()); err != nil {
		slog.Error("marking import failed", "batch", batchID, "err", err)
	}
}

// ForceImport turns a duplicate row into a real transaction. The row keeps its
// content hash; it just claims the next free occurrence for that hash, so it
// coexists with the copy it collided with and future imports dedup against it too.
func (d *Data) ForceImport(ctx context.Context, userID, rowID string) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var (
		bucketID, currency, status, hash string
		date                             time.Time
		amount                           int64
		raw                              json.RawMessage
	)
	err = tx.QueryRowContext(ctx,
		`select b.bucket_id, r.date, r.amount, r.currency, r.raw, r.status, r.dedup_hash
		 from import_rows r join import_batches b on b.id = r.batch_id
		 where r.id = $1 and b.user_id = $2`, rowID, userID).
		Scan(&bucketID, &date, &amount, &currency, &raw, &status, &hash)
	if err == sql.ErrNoRows {
		return ErrImportNotFound
	}
	if err != nil {
		return err
	}
	if status != "duplicate" {
		return ErrNotDuplicate
	}

	var fields struct {
		Payee   string `json:"payee"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}

	uncategorized, err := uncategorizedBucketID(ctx, tx, userID)
	if err != nil {
		return err
	}

	var occurrence int
	if err := tx.QueryRowContext(ctx,
		"select coalesce(max(occurrence)+1, 0) from import_rows where dedup_hash = $1 and status = 'imported'",
		hash).Scan(&occurrence); err != nil {
		return err
	}

	txnID, err := insertImportTransaction(ctx, tx, userID, bucketID, uncategorized, ParsedRow{
		Date: date, Amount: amount, Currency: currency, Payee: fields.Payee, Message: fields.Message,
	})
	if err != nil {
		return err
	}

	before, err := loadImportRow(ctx, tx, rowID)
	if err != nil {
		return err
	}
	if err := auditWrite(ctx, tx, userID, "import_rows", rowID, "update", before); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		"update import_rows set status = 'imported', transaction_id = $1, duplicate_of = null, occurrence = $2 where id = $3",
		txnID, occurrence, rowID); err != nil {
		return err
	}

	return tx.Commit()
}

// DeleteImport drops the batch, its rows and any transactions promotion created,
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
	err = tx.QueryRowContext(ctx, "select user_id from import_batches where id = $1", batchID).Scan(&owner)
	if err == sql.ErrNoRows || (err == nil && owner != userID) {
		return ErrImportNotFound
	}
	if err != nil {
		return err
	}

	txnScope := "select transaction_id from import_rows where batch_id = $2 and transaction_id is not null"
	audits := []string{
		"select uuidv7(), $1, 'import_batches', b.id, 'delete', to_jsonb(b), now() from import_batches b where b.id = $2",
		"select uuidv7(), $1, 'import_rows', r.id, 'delete', to_jsonb(r), now() from import_rows r where r.batch_id = $2",
		"select uuidv7(), $1, 'transactions', t.id, 'delete', to_jsonb(t), now() from transactions t where t.id in (" + txnScope + ")",
		"select uuidv7(), $1, 'postings', p.id, 'delete', to_jsonb(p), now() from postings p where p.transaction_id in (" + txnScope + ")",
	}
	for _, sel := range audits {
		if _, err := tx.ExecContext(ctx,
			"insert into audit_logs (id, actor_user_id, table_name, row_id, operation, before, created_at) "+sel,
			userID, batchID); err != nil {
			return err
		}
	}

	// transactions first (postings cascade), then rows, then the batch.
	if _, err := tx.ExecContext(ctx,
		"delete from transactions where id in (select transaction_id from import_rows where batch_id = $1 and transaction_id is not null)",
		batchID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "delete from import_rows where batch_id = $1", batchID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "delete from import_batches where id = $1", batchID); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}
	if err := d.files.Delete(ctx, batchID); err != nil {
		slog.Error("import blob delete failed", "batch", batchID, "err", err)
	}
	return nil
}

func (d *Data) ListImports(ctx context.Context, userID string) ([]ImportBatch, error) {
	rows, err := d.db.QueryContext(ctx,
		`select b.id, b.bucket_id, b.filename, b.created_at, b.status,
		        count(*) filter (where r.status = 'imported'),
		        count(*) filter (where r.status = 'duplicate')
		 from import_batches b
		 left join import_rows r on r.batch_id = b.id
		 where b.user_id = $1
		 group by b.id
		 order by b.created_at desc`, userID)
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
		        count(*) filter (where r.status = 'imported'),
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
	err := d.db.QueryRowContext(ctx,
		"select id, user_id, bucket_id, source, filename, created_at, status from import_batches where id = $1 and user_id = $2",
		batchID, userID).Scan(&b.ID, &b.UserID, &b.BucketID, &b.Source, &b.Filename, &b.CreatedAt, &b.Status)
	if err == sql.ErrNoRows {
		return nil, nil, ErrImportNotFound
	}
	if err != nil {
		return nil, nil, err
	}

	rows, err := d.db.QueryContext(ctx,
		`select r.id, r.batch_id, r.date, r.amount, r.currency, r.raw_description, r.raw, r.status, r.transaction_id, r.duplicate_of,
		        t.date, t.amount, t.currency, t.raw_description, t.transaction_id, tb.id, tb.created_at
		 from import_rows r
		 left join import_rows t on t.id = r.duplicate_of
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
		`select r.id, r.batch_id, r.date, r.amount, r.currency, r.raw_description, r.raw, r.status, r.transaction_id, r.duplicate_of,
		        t.date, t.amount, t.currency, t.raw_description, t.transaction_id, tb.id, tb.created_at
		 from import_rows r
		 join import_batches b on b.id = r.batch_id
		 left join import_rows t on t.id = r.duplicate_of
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

func uncategorizedBucketID(ctx context.Context, tx *sql.Tx, userID string) (string, error) {
	var id string
	err := tx.QueryRowContext(ctx,
		"select id from buckets where owner_user_id = $1 and kind = 'expense' and hidden = true limit 1", userID).Scan(&id)
	return id, err
}

func insertImportTransaction(ctx context.Context, tx *sql.Tx, userID, bucketID, uncategorized string, row ParsedRow) (string, error) {
	txn := Transaction{ID: NewPrivateID(), OwnerUserID: userID, Date: row.Date, Counterparty: row.Payee, Description: row.Message}
	postings := []Posting{
		{BucketID: bucketID, Amount: row.Amount, Currency: row.Currency},
		{BucketID: uncategorized, Amount: -row.Amount, Currency: row.Currency},
	}
	if err := insertTransactionTx(ctx, tx, &txn, postings); err != nil {
		return "", err
	}
	return txn.ID, nil
}

func loadImportRow(ctx context.Context, tx *sql.Tx, rowID string) (*ImportRow, error) {
	var r ImportRow
	err := tx.QueryRowContext(ctx,
		`select id, batch_id, date, amount, currency, raw_description, raw, dedup_hash, occurrence, status, transaction_id, duplicate_of
		 from import_rows where id = $1`, rowID).
		Scan(&r.ID, &r.BatchID, &r.Date, &r.Amount, &r.Currency, &r.RawDescription, &r.Raw, &r.DedupHash, &r.Occurrence, &r.Status, &r.TransactionID, &r.DuplicateOf)
	if err != nil {
		return nil, err
	}
	return &r, nil
}
