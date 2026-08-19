package data

import (
	"context"
	"database/sql"
)

func applySchema(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `
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

create table if not exists bank_integrations (
    id uuid primary key,
    user_id uuid not null references users(id),
    provider text not null,
    data jsonb not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    deleted_at timestamptz
);
create index if not exists idx_bank_integrations_user on bank_integrations(user_id) where deleted_at is null;

create table if not exists buckets (
    id uuid primary key,
    owner_user_id uuid not null references users(id),
    kind text not null check (kind in ('asset', 'liability', 'expense', 'income', 'person', 'transit', 'fx_conversion')),
    name text not null,
    parent_id uuid references buckets(id),
    counterpart_user_id uuid references users(id),
    iban text,
    active_bank_integration_id uuid references bank_integrations(id) on delete set null,
    hidden boolean not null default false,
    created_at timestamptz not null,
    unique (owner_user_id, counterpart_user_id)
);
create index if not exists idx_buckets_owner on buckets(owner_user_id);
create unique index if not exists idx_buckets_one_transit on buckets(owner_user_id) where kind = 'transit';
create unique index if not exists idx_buckets_one_fx_conversion on buckets(owner_user_id) where kind = 'fx_conversion';
create unique index if not exists idx_buckets_owner_iban on buckets(owner_user_id, iban) where iban is not null;

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
    occurred_on date not null,
    occurred_at timestamptz,
    counterparty text not null default '',
    description text not null default '',
    memo text not null default '',
    created_at timestamptz not null
);
create index if not exists idx_transactions_owner on transactions(owner_user_id);
create index if not exists idx_transactions_owner_occurred on transactions(owner_user_id, occurred_on desc, id desc);

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
    updated_at timestamptz not null default now(),
    check (amount <> 0)
);
alter table postings add column if not exists updated_at timestamptz not null default now();
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
    created_at timestamptz not null,
    status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'queued', 'syncing', 'done', 'failed')),
    error text,
    parse_errors jsonb
);
alter table import_batches drop column if exists timezone;
create index if not exists idx_import_batches_user on import_batches(user_id);
create index if not exists idx_import_batches_claim on import_batches(created_at) where status = 'uploaded';
create index if not exists idx_import_batches_sync_claim on import_batches(created_at) where status = 'queued';

create table if not exists enable_banking_syncs (
    batch_id uuid primary key references import_batches(id) on delete cascade,
    integration_id uuid not null references bank_integrations(id),
    identification_hash text not null,
    account_uid text not null,
    date_from date not null,
    date_to date not null,
    continuation_key text not null default '',
    seen_continuation_keys text[] not null default '{}',
    next_sequence bigint not null default 0,
    fetched_all boolean not null default false,
    use_longest boolean not null default false,
    attempts int not null default 0,
    next_attempt_at timestamptz not null default now(),
    completed_at timestamptz
);
alter table enable_banking_syncs add column if not exists use_longest boolean not null default false;
create unique index if not exists idx_enable_banking_syncs_active_account
    on enable_banking_syncs(integration_id, identification_hash) where completed_at is null;
create index if not exists idx_enable_banking_syncs_ready
    on enable_banking_syncs(next_attempt_at) where completed_at is null;

create table if not exists import_staged_rows (
    id uuid primary key,
    batch_id uuid not null references import_batches(id) on delete cascade,
    sequence bigint not null,
    occurred_on date not null,
    occurred_at timestamptz,
    amount bigint not null check (amount <> 0),
    currency text not null references currencies(code),
    counterparty text not null default '',
    note text not null default '',
    dedup_hash text not null,
    occurrence int not null default 0,
    unique (batch_id, sequence)
);
create index if not exists idx_import_staged_rows_batch on import_staged_rows(batch_id, sequence);

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
    occurred_on date not null,
    occurred_at timestamptz,
    amount bigint not null,
    currency text not null references currencies(code),
    counterparty text not null default '',
    note text not null default '',
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
`)
	return err
}
