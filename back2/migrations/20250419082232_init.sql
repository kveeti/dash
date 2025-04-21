create table users (
    id varchar(30) primary key not null,
    external_id varchar(36) not null unique,
    locale text not null
);

create table sessions (
    id varchar(30) primary key not null,
    user_id varchar(30) not null
);

-- transaction_categories
create table transaction_categories (
    id varchar(30) primary key not null,
    user_id varchar(30) not null,

    is_neutral boolean not null,
    name varchar(100) not null,
    created_at timestamptz not null,
    updated_at timestamptz
);

create index idx_transaction_categories_user_id_lower_name on transaction_categories(user_id, lower(name));

create unique index on transaction_categories (user_id, lower(name));
-- transaction_categories

-- transactions
create table transactions (
    id varchar(30) primary key not null,
    user_id varchar(30) not null,

    date timestamptz not null,
    amount real not null,
    currency varchar(3) not null,
    counter_party varchar(255) not null,
    additional text,
    category_id varchar(30),
    created_at timestamptz not null,
    updated_at timestamptz
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
	id varchar(30) primary key not null,
	user_id varchar(30) not null,

	transaction_a_id varchar(30) not null,
	transaction_b_id varchar(30) not null,
	created_at timestamptz not null,
	updated_at timestamptz
);

create index if not exists idx_transactions_links_user_id_ids on transactions_links(user_id, transaction_a_id, transaction_b_id);

create unique index on transactions_links (transaction_a_id, transaction_b_id);

create unique index on transactions_links (transaction_b_id, transaction_a_id);
-- transaction_links
