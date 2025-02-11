import postgres from "postgres";

import { envs } from "../envs.ts";
import { categories } from "./categories.ts";
import { transactions } from "./transactions.ts";
import { users } from "./users.ts";

export async function getData() {
	const pg = postgres(envs.pgUrl, {
		connect_timeout: 2.5,
		max: 20,
		types: {
			bigint: postgres.BigInt,
		},
	});
	await migratePg(pg);

	return {
		users: users(pg),
		transactions: transactions(pg),
		categories: categories(pg),
		close: async () => {
			await pg.end({ timeout: 2.5 });
		},
	};
}

export type Pg = ReturnType<typeof postgres>;
export type Data = Awaited<ReturnType<typeof getData>>;

async function migratePg(pg: Pg) {
	const script_1 = (pg: Pg) =>
		pg`
create table users (
	id varchar(30) primary key not null,
	username varchar(30) not null unique,
	password_hash text not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz
);

create table transaction_categories (
	id varchar(30) primary key not null,
	name varchar(100) not null,
	user_id varchar(30) not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz,
	foreign key (user_id) references users(id)
);
create index idx_transaction_categories_user_id_lower_name on transaction_categories(user_id, lower(name));
create unique index on transaction_categories (user_id, lower(name));

create table transactions (
	id varchar(30) primary key not null,
	date timestamptz not null,
	amount real not null,
	currency varchar(10) not null,
	counter_party varchar(255) not null,
	additional text,
	user_id varchar(30) not null,
	category_id varchar(30),
	created_at timestamptz not null default now(),
	updated_at timestamptz,
	foreign key (user_id) references users(id),
	foreign key (category_id) references transaction_categories(id)
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

create table if not exists transaction_tags (
	id varchar(30) not null,
	user_id varchar(30) not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz,
	primary key (id),
	foreign key (user_id) references users(id)
);
create index if not exists idx_transaction_tags_user_id on transaction_tags(user_id);

create table if not exists transactions_tags (
	transaction_id varchar(30) not null,
	tag_id varchar(30) not null,
	user_id varchar(30) not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz,
	foreign key (transaction_id) references transactions(id),
	foreign key (tag_id) references transaction_tags(id),
	foreign key (user_id) references users(id),
	primary key (transaction_id, tag_id)
);
create index if not exists idx_transactions_tags_user_id on transactions_tags(user_id);
`.simple();

	const script_2 = (pg: Pg) =>
		pg`
alter table transaction_categories add column is_neutral boolean not null default false;
`.simple();

	const script_3 = (pg: Pg) =>
		pg`
create table user_preferences (
	user_id varchar(30) primary key not null,

	locale varchar(5) not null default 'en-FI',
	created_at timestamptz not null default now(),
	updated_at timestamptz,

	foreign key (user_id) references users(id)
);
`.simple();

	const script_4 = (pg: Pg) =>
		pg`
create table if not exists transactions_links (
	id varchar(30) not null primary key,
	transaction_a_id varchar(30) not null,
	transaction_b_id varchar(30) not null,
	user_id varchar(30) not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz,
	foreign key (transaction_a_id) references transactions(id),
	foreign key (transaction_b_id) references transactions(id),
	foreign key (user_id) references users(id)
);
create index if not exists idx_transactions_links_user_id_ids on transactions_links(user_id, transaction_a_id, transaction_b_id);
create unique index on transactions_links (transaction_a_id, transaction_b_id);
create unique index on transactions_links (transaction_b_id, transaction_a_id);
`.simple();

	const scripts = [script_1, script_2, script_3, script_4];

	await pg.begin(async (t) => {
		await t`create table if not exists __version (v int);`;
		let version = 1;
		const [row]: [{ v: number }?] = await t`select v from __version limit 1;`;
		if (!row) {
			await t`insert into __version (v) values (1);`;
		} else {
			version = row.v;
		}

		if (version >= scripts.length) {
			console.log("no migrations to run", { version });
			return;
		}

		let latestVersion = 1;
		for (let i = 0; i < scripts.length; i++) {
			const newVersion = i + 1;

			const script = scripts[i];
			await script(t);
			await t`update __version set v = ${newVersion}`;
			latestVersion = newVersion;
		}

		console.log("migrated db to version", latestVersion);
	});
}
