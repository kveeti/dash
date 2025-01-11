import postgres from "postgres";

import { envs } from "../envs.ts";
import { categories } from "./categories.ts";
import { transactions } from "./transactions.ts";
import { users } from "./users.ts";

export async function getData() {
	const pg = postgres(envs.pgUrl, {
		connect_timeout: 2.5,
		max: 20,
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
	password_hash varchar(255) not null,
	created_at timestamptz not null
);

create table transaction_categories (
    id varchar(30) primary key not null,
    name varchar(100) not null,
    user_id varchar(30) not null,
    foreign key (user_id) references users(id),
    unique(user_id, name)
);
create index idx_transaction_categories_user_id_lower_name on transaction_categories(user_id, lower(name));

create table transactions (
    id varchar(30) primary key not null,
    date timestamptz not null,
    amount real not null,
    currency varchar(10) not null,
    counter_party varchar(255) not null,
    additional text,
    user_id varchar(30) not null,
    category_id varchar(30),
    foreign key (user_id) references users(id),
    foreign key (category_id) references transaction_categories(id)
);
create index idx_transactions_user_id on transactions(user_id);
create index idx_transactions_date on transactions(date);
create index idx_transactions_category_id on transactions(category_id);
create index idx_transactions_user_id_id on transactions(user_id, id);

create table if not exists transaction_tags (
    id varchar(30) not null,
    user_id varchar(30) not null,
    primary key (id),
    foreign key (user_id) references users(id)
);
create index if not exists idx_transaction_tags_user_id on transaction_tags(user_id);

create table if not exists transactions_tags (
    transaction_id varchar(30) not null,
    tag_id varchar(30) not null,
    user_id varchar(30) not null,
    foreign key (transaction_id) references transactions(id),
    foreign key (tag_id) references transaction_tags(id),
    foreign key (user_id) references users(id),
    primary key (transaction_id, tag_id)
);
create index if not exists idx_transactions_tags_user_id on transactions_tags(user_id);

create table if not exists transactions_links (
    transaction_a_id varchar(30) not null,
    transaction_b_id varchar(30) not null,
    created_at timestamptz not null,
    user_id varchar(30) not null,
    foreign key (transaction_a_id) references transactions(id),
    foreign key (transaction_b_id) references transactions(id),
    foreign key (user_id) references users(id),
    primary key (transaction_a_id, transaction_b_id)
);
create index if not exists idx_transactions_links_user_id_ids on transactions_links(user_id, transaction_a_id, transaction_b_id);
`.simple();

	await pg.begin(async (pg) => {
		await pg`create table if not exists __version (v int);`;

		let v = 1;
		const [row]: [{ v: number }?] = await pg`select v from __version limit 1;`;
		if (!row) {
			await pg`insert into __version (v) values (1);`;
		} else {
			v = row.v;
		}

		if (v < 2) {
			console.log("running script 1");
			await script_1(pg);
			await pg`update __version set v = 2;`;
			console.log("ran script 1");
		}
	});
}
