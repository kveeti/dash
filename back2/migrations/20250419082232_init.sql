create table users (
    id varchar(30) primary key not null,
    external_id varchar(36) not null unique,
    created_at timestamptz not null,
    updated_at timestamptz,

    locale text not null
);

create table sessions (
    id varchar(30) primary key not null,
    user_id varchar(30) not null,
    created_at timestamptz not null,
    updated_at timestamptz
);

-- transaction_categories
create table transaction_categories (
    id varchar(30) primary key not null,
    user_id varchar(30) not null,
    created_at timestamptz not null,
    updated_at timestamptz,

    is_neutral boolean not null,
    name varchar(100) not null
);

create index idx_transaction_categories_user_id_lower_name on transaction_categories(user_id, lower(name));

create unique index on transaction_categories (user_id, lower(name));
-- transaction_categories

-- accounts
create table accounts (
    id text primary key not null,
    user_id varchar(30) not null,
    created_at timestamptz not null,
    updated_at timestamptz,

    -- actual id of account, comes from bank, usually iban
    -- null when not synced
    external_id text,
    name text not null
);

create unique index on accounts (user_id, name);
-- accounts

-- transactions
create table transactions (
    id varchar(30) primary key not null,
    user_id varchar(30) not null,
    created_at timestamptz not null,
    updated_at timestamptz,

    date timestamptz not null,
    amount real not null,
    currency varchar(3) not null,
    counter_party text not null,
    og_counter_party text not null,
    additional text,
    category_id varchar(30),
    account_id text not null
);

create index idx_transactions_user_id on transactions(user_id);

create index idx_transactions_category_id on transactions(category_id);

create index idx_transactions_user_id_id on transactions(user_id, id);

create index idx_transactions_user_date_id on transactions(user_id, date desc, id desc);

alter table transactions add column ts tsvector;
create index idx_transactions_ts on transactions using gin(ts);

create function update_search_vector() returns trigger as $$
begin
    new.ts := to_tsvector('english', coalesce(new.counter_party, '') || ' ' || coalesce(new.additional, ''));
    return new;
end;
$$ language plpgsql;

create trigger transactions_search_vector_trigger
before insert or update on transactions
for each row execute function update_search_vector();
-- transactions

-- transaction_tags
create table if not exists transaction_tags (
    id varchar(30) primary key not null,
    user_id varchar(30) not null,
    created_at timestamptz not null,
    updated_at timestamptz
);

create index if not exists idx_transaction_tags_user_id on transaction_tags(user_id);
-- transaction_tags

-- transaction_links
create table if not exists transactions_links (
    user_id varchar(30) not null,
    created_at timestamptz not null,
    updated_at timestamptz,

    transaction_a_id varchar(30) not null,
    transaction_b_id varchar(30) not null,

    primary key (user_id, transaction_a_id, transaction_b_id)
);
create unique index on transactions_links (user_id, transaction_a_id, transaction_b_id);
-- transaction_links

-- user_bank_integrations
create table user_bank_integrations (
    user_id varchar(30) not null,
    created_at timestamptz not null,
    updated_at timestamptz,

    name text not null,
    data jsonb not null,

    primary key (user_id, name)
);

create index idx_user_bank_integrations_user_id on user_bank_integrations (user_id);
-- user_bank_integrations

-- transaction_imports
create table transaction_imports (
    id varchar(30) primary key not null,
    import_id varchar(30) not null,
    user_id varchar(30) not null,
    created_at timestamptz not null,

    date timestamptz not null,
    amount real not null,
    currency varchar(3) not null,
    counter_party text not null,
    og_counter_party text not null,
    additional text,
    account_id varchar(30) not null,
    category_name varchar(100),
    category_id varchar(30)
);
create index idx_transaction_imports_import_id on transaction_imports (import_id);
-- transaction_imports
