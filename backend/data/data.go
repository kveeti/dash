package data

import (
	"context"
	"database/sql"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type Data struct {
	*Users
	*Sessions
	db         *sql.DB
	files      FileStore
	importKick chan struct{}
}

// NewData connects to Postgres, applies the schema, and selects the import file
// store: "disk" (under importDir) or Postgres bytea (default). importDir is only
// read for the disk store.
func NewData(ctx context.Context, dbUrl, importStore, importDir string) (*Data, error) {
	db, err := connectPostgres(ctx, dbUrl)
	if err != nil {
		return nil, fmt.Errorf("error connecting to postgres: %w", err)
	}

	var files FileStore
	if importStore == "disk" {
		files, err = NewDiskFileStore(importDir)
		if err != nil {
			return nil, fmt.Errorf("error creating import file store: %w", err)
		}
	} else {
		files = NewPostgresFileStore(db)
	}

	return &Data{
		Users:      NewUsers(db),
		Sessions:   NewSessions(db),
		db:         db,
		files:      files,
		importKick: make(chan struct{}, 1),
	}, nil
}

func connectPostgres(ctx context.Context, dbURL string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		return nil, fmt.Errorf("error opening database: %w", err)
	}

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("error pinging database: %w", err)
	}

	if _, err := db.ExecContext(ctx, schema); err != nil {
		return nil, fmt.Errorf("error applying schema: %w", err)
	}

	return db, nil
}

const schema = `
create table if not exists users (
    id uuid primary key,
    subject text not null,
    issuer text not null,
    email text not null,
    home_currency text not null default 'EUR',
    created_at timestamptz not null,
    unique (issuer, subject)
);

create table if not exists sessions (
    id uuid primary key,
    user_id uuid not null references users(id),
    token_hash text not null unique,
    created_at timestamptz not null,
    expires_at timestamptz not null
);
create index if not exists idx_sessions_user_id on sessions(user_id);

create table if not exists buckets (
    id uuid primary key,
    owner_user_id uuid not null references users(id),
    kind text not null check (kind in ('asset', 'liability', 'expense', 'income', 'person', 'clearing')),
    name text not null,
    parent_id uuid references buckets(id),
    counterpart_user_id uuid references users(id),
    hidden boolean not null default false,
    created_at timestamptz not null,
    unique (owner_user_id, counterpart_user_id)
);
create index if not exists idx_buckets_owner on buckets(owner_user_id);

create table if not exists audit_logs (
    id uuid primary key,
    actor_user_id uuid not null references users(id),
    table_name text not null,
    row_id uuid not null,
    operation text not null check (operation in ('insert', 'update', 'delete')),
    before jsonb,
    created_at timestamptz not null
);
create index if not exists idx_audit_logs_row on audit_logs(table_name, row_id);

create table if not exists transactions (
    id uuid primary key,
    owner_user_id uuid not null references users(id),
    date timestamptz not null,
    counterparty text not null default '',
    description text not null default '',
    created_at timestamptz not null
);
create index if not exists idx_transactions_owner on transactions(owner_user_id);

create table if not exists postings (
    id uuid primary key,
    transaction_id uuid not null references transactions(id) on delete cascade,
    bucket_id uuid not null references buckets(id),
    amount bigint not null,
    currency text not null,
    mirror_id uuid,
    created_at timestamptz not null
);
create index if not exists idx_postings_transaction on postings(transaction_id);
create index if not exists idx_postings_bucket on postings(bucket_id);

create table if not exists rates (
    date date not null,
    currency text not null,
    rate numeric not null check (rate > 0),
    primary key (date, currency)
);
create index if not exists idx_rates_currency_date on rates(currency, date desc);

create table if not exists transaction_tags (
    id uuid primary key,
    transaction_id uuid not null references transactions(id) on delete cascade,
    tag text not null,
    created_at timestamptz not null,
    unique (transaction_id, tag)
);
create index if not exists idx_transaction_tags_tag on transaction_tags(tag, transaction_id);

create table if not exists import_batches (
    id uuid primary key,
    user_id uuid not null references users(id),
    bucket_id uuid not null references buckets(id),
    source text not null,
    filename text not null,
    timezone text not null,
    created_at timestamptz not null,
    status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'done', 'failed')),
    error text,
    parse_errors jsonb
);
create index if not exists idx_import_batches_user on import_batches(user_id);
create index if not exists idx_import_batches_claim on import_batches(created_at) where status = 'uploaded';

-- The uploaded file itself: the durable work item. Written at ingest, read by the
-- worker, deleted when the batch is done. No FK (blob-first: the blob lands before
-- the batch pointer, and disk/object stores have no FK anyway).
create table if not exists import_files (
    batch_id uuid primary key,
    content bytea not null,
    created_at timestamptz not null
);

create table if not exists import_rows (
    id uuid primary key,
    batch_id uuid not null references import_batches(id),
    date timestamptz not null,
    amount bigint not null,
    currency text not null,
    raw_description text not null,
    raw jsonb not null,
    dedup_hash text not null,
    occurrence int not null default 0,
    status text not null check (status in ('pending', 'categorized', 'duplicate')),
    transaction_id uuid references transactions(id) on delete set null,
    duplicate_of uuid references import_rows(id) on delete set null
);
create index if not exists idx_import_rows_batch on import_rows(batch_id);
create index if not exists idx_import_rows_dupes on import_rows(batch_id, id) where status = 'duplicate';
-- FK back-references, else deleting a parent seq-scans import_rows per row (O(n^2) undo).
create index if not exists idx_import_rows_txn on import_rows(transaction_id) where transaction_id is not null;
create index if not exists idx_import_rows_dupof on import_rows(duplicate_of) where duplicate_of is not null;
-- dedup memory = every row that isn't a duplicate (pending/categorized both block re-import).
create unique index if not exists idx_import_rows_dedup_occ on import_rows(dedup_hash, occurrence) where status <> 'duplicate';
`
