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
create table if not exists currencies (
    code text primary key check (code ~ '^[A-Z]{3}$'),
    exponent smallint not null check (exponent between 0 and 6)
);
insert into currencies (code, exponent) values
    ('EUR', 2), ('USD', 2), ('GBP', 2), ('JPY', 0), ('CHF', 2),
    ('AUD', 2), ('CAD', 2), ('SEK', 2), ('NOK', 2), ('DKK', 2), ('PLN', 2)
on conflict (code) do update set exponent = excluded.exponent;

create table if not exists users (
    id uuid primary key,
    subject text not null,
    issuer text not null,
    email text not null,
    home_currency text not null default 'EUR' references currencies(code),
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
    kind text not null check (kind in ('asset', 'liability', 'expense', 'income', 'person', 'transit', 'fx_conversion')),
    name text not null,
    parent_id uuid references buckets(id),
    counterpart_user_id uuid references users(id),
    hidden boolean not null default false,
    created_at timestamptz not null,
    unique (owner_user_id, counterpart_user_id)
);
create index if not exists idx_buckets_owner on buckets(owner_user_id);
create unique index if not exists idx_buckets_one_transit on buckets(owner_user_id) where kind = 'transit';
create unique index if not exists idx_buckets_one_fx_conversion on buckets(owner_user_id) where kind = 'fx_conversion';

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
    occurred_at timestamptz not null,
    counterparty text not null default '',
    description text not null default '',
    memo text not null default '',
    created_at timestamptz not null
);
create index if not exists idx_transactions_owner on transactions(owner_user_id);
create index if not exists idx_transactions_owner_occurred on transactions(owner_user_id, occurred_at desc, id desc);

create table if not exists postings (
    id uuid primary key,
    transaction_id uuid not null references transactions(id) on delete cascade,
    bucket_id uuid not null references buckets(id),
    amount bigint not null,
    currency text not null references currencies(code),
    stats_date date,
    memo text not null default '',
    import_row_id uuid unique,
    mirror_id uuid,
    created_at timestamptz not null,
    check (amount <> 0)
);
create index if not exists idx_postings_transaction on postings(transaction_id);
create index if not exists idx_postings_bucket on postings(bucket_id);
create unique index if not exists idx_postings_one_import on postings(transaction_id) where import_row_id is not null;

create table if not exists rates (
    date date not null,
    currency text not null references currencies(code),
    rate numeric not null check (rate > 0),
    primary key (date, currency)
);
create index if not exists idx_rates_currency_date on rates(currency, date desc);

create table if not exists posting_tags (
    id uuid primary key,
    posting_id uuid not null references postings(id) on delete cascade,
    tag text not null check (tag = lower(btrim(tag)) and tag <> ''),
    created_at timestamptz not null,
    unique (posting_id, tag)
);
create index if not exists idx_posting_tags_tag on posting_tags(tag, posting_id);

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
    currency text not null references currencies(code),
    raw_description text not null,
    raw jsonb not null,
    dedup_hash text not null,
    occurrence int not null default 0,
    status text not null check (status in ('pending', 'categorized', 'duplicate')),
    duplicate_of uuid references import_rows(id) on delete set null
);
create index if not exists idx_import_rows_batch on import_rows(batch_id);
create index if not exists idx_import_rows_dupes on import_rows(batch_id, id) where status = 'duplicate';
create index if not exists idx_import_rows_dupof on import_rows(duplicate_of) where duplicate_of is not null;
-- dedup memory = every row that isn't a duplicate (pending/categorized both block re-import).
create unique index if not exists idx_import_rows_dedup_occ on import_rows(dedup_hash, occurrence) where status <> 'duplicate';

do $$ begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'postings_import_row_fk' and conrelid = 'postings'::regclass
    ) then
        alter table postings add constraint postings_import_row_fk foreign key (import_row_id) references import_rows(id);
    end if;
end $$;

create table if not exists account_movement_matches (
    id uuid primary key,
    owner_user_id uuid not null references users(id),
    outgoing_transaction_id uuid not null unique references transactions(id) on delete cascade,
    incoming_transaction_id uuid not null unique references transactions(id) on delete cascade,
    created_at timestamptz not null,
    check (outgoing_transaction_id <> incoming_transaction_id)
);
create index if not exists idx_account_movement_matches_owner on account_movement_matches(owner_user_id);

-- Business rules are checked by Go while holding the relevant row locks. Drop
-- triggers left by older schema versions; only local constraints live here.
drop trigger if exists postings_validate_import on postings;
drop trigger if exists transactions_protect_import_time on transactions;
drop trigger if exists import_rows_protect_facts on import_rows;
drop trigger if exists import_rows_validate_status on import_rows;
drop trigger if exists postings_validate_import_status on postings;
drop function if exists validate_import_posting();
drop function if exists protect_imported_transaction_time();
drop function if exists protect_import_row_facts();
drop function if exists validate_import_row_status_from_row();
drop function if exists validate_import_row_status_from_posting();
drop function if exists check_import_row_status(uuid);
`
