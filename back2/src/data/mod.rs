use indexmap::IndexMap;
use sqlx::Row;
use std::collections::HashMap;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use futures::TryStreamExt;
use serde::Serialize;
use serde_json::Value;
use sqlx::{PgPool, Postgres, QueryBuilder, prelude::FromRow, query, query_as};
use tokio::io::AsyncRead;
use utoipa::ToSchema;

use crate::{config::Config, endpoints::transactions::query::TransactionsQueryOutput};

mod id;
pub use id::create_id;

#[derive(Clone)]
pub struct Data {
    pg_pool: sqlx::PgPool,
}

impl Data {
    pub async fn new(config: &Config) -> Result<Self> {
        let pg = PgPool::connect(&config.database_url)
            .await
            .context("error connecting to postgres")?;

        return Ok(Self {
            pg_pool: pg.clone(),
        });
    }

    pub fn get_pg_pool(self) -> sqlx::PgPool {
        return self.pg_pool;
    }

    pub async fn query_categories_with_counts(
        &self,
        user_id: &str,
        search_text: &Option<String>,
    ) -> Result<Vec<CategoryWithCounts>, sqlx::Error> {
        let mut qb = QueryBuilder::new(
            "select tc.id, tc.name, tc.is_neutral, coalesce(count(t.id), 0)::bigint as tx_count
             from transaction_categories tc
             left join transactions t on tc.id = t.category_id
             where tc.user_id = ",
        );

        qb.push_bind(user_id);

        if let Some(search_text) = search_text {
            qb.push(" and name ilike ");
            qb.push_bind(format!("%{}%", search_text));
        }

        qb.push(" group by tc.id");

        let query = qb.build_query_as::<CategoryWithCounts>();
        let rows = query.fetch_all(&self.pg_pool).await?;

        Ok(rows)
    }

    pub async fn query_categories(
        &self,
        user_id: &str,
        search_text: &Option<String>,
    ) -> Result<Vec<Category>, sqlx::Error> {
        let mut qb = QueryBuilder::new(
            "select tc.id, tc.name, tc.is_neutral
             from transaction_categories tc
             where tc.user_id = ",
        );

        qb.push_bind(user_id);

        if let Some(search_text) = search_text {
            qb.push(" and name ilike ");
            qb.push_bind(format!("%{}%", search_text));
        }

        let query = qb.build_query_as::<Category>();
        let rows = query.fetch_all(&self.pg_pool).await?;

        Ok(rows)
    }

    pub async fn insert_category(
        &self,
        user_id: &str,
        category_id: &str,
        name: &str,
        is_neutral: bool,
    ) -> Result<(), sqlx::Error> {
        let created_at = Utc::now();
        let updated_at: Option<DateTime<Utc>> = None;

        query!(
            r#"
            insert into transaction_categories
            (id, user_id, created_at, updated_at, name, is_neutral)
            values ($1, $2, $3, $4, $5, $6)
            "#,
            category_id,
            user_id,
            created_at,
            updated_at,
            name,
            is_neutral
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn update_category(
        &self,
        user_id: &str,
        category_id: &str,
        name: &str,
        is_neutral: bool,
    ) -> Result<(), sqlx::Error> {
        query!(
            r#"
            update transaction_categories
            set 
                name = $3,
                is_neutral = $4,
                updated_at = $5
            where user_id = $1 and id = $2
            "#,
            user_id,
            category_id,
            name,
            is_neutral,
            Utc::now()
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn delete_category_if_unused(
        &self,
        user_id: &str,
        category_id: &str,
    ) -> Result<bool, sqlx::Error> {
        let mut tx = self.pg_pool.begin().await?;

        let has_transactions = query!(
            r#"
                select exists(
                    select 1 
                    from transactions
                    where category_id = $1 and user_id = $2
                    limit 1
                ) as "has_transactions!"
            "#,
            category_id,
            user_id
        )
        .fetch_one(&mut *tx)
        .await?
        .has_transactions;

        if !has_transactions {
            query!(
                r#"
                    delete from transaction_categories
                    where user_id = $1 and id = $2
                "#,
                user_id,
                category_id
            )
            .execute(&mut *tx)
            .await?;

            tx.commit().await?;
            Ok(true)
        } else {
            tx.rollback().await?;
            Ok(false)
        }
    }

    pub async fn query_accounts(
        &self,
        user_id: &str,
        search_text: &Option<String>,
    ) -> Result<Vec<Account>, sqlx::Error> {
        let rows = if let Some(search_text) = search_text {
            query_as!(
                Account,
                "select id, name from accounts where user_id = $1 and name ilike $2",
                user_id,
                format!("%{}%", search_text)
            )
            .fetch_all(&self.pg_pool)
            .await?
        } else {
            query_as!(
                Account,
                "select id, name from accounts where user_id = $1",
                user_id
            )
            .fetch_all(&self.pg_pool)
            .await?
        };

        Ok(rows)
    }

    pub async fn query_transactions(
        &self,
        user_id: &str,
        input: QueryTxInput,
    ) -> Result<TransactionsQueryOutput, sqlx::Error> {
        let mut query: QueryBuilder<Postgres> = QueryBuilder::new(
            r#"
            select
                t.id as id,
                t.date as date,
                t.counter_party as counter_party,
                t.amount as amount,
                t.category_id as category_id,
                t.currency as currency,
                t.additional as additional,

                c.name as c_name,
                c.is_neutral as c_is_neutral,

                    accounts.id as account_id,
                    accounts.name as account_name,

                link.created_at as link_created_at,
                link.updated_at as link_updated_at,

                linked.id as l_id,
                linked.amount as l_amount,
                linked.date as l_date,
                linked.counter_party as l_counter_party,
                linked.additional as l_additional,
                linked.currency as l_currency,
                linked.category_id as l_category_id
            from transactions t
            left join accounts on t.account_id = accounts.id
            left join transaction_categories c on t.category_id = c.id
            left join transactions_links link
                on link.transaction_a_id = t.id or link.transaction_b_id = t.id
            left join transactions linked
                on (linked.id = case when link.transaction_a_id = t.id then link.transaction_b_id else link.transaction_a_id end)
            "#,
        );

        query.push("where t.user_id = ").push_bind(user_id);

        if let Some(search_text) = input.search_text {
            query
                .push(" and t.ts @@ plainto_tsquery('english', ")
                .push_bind(search_text)
                .push(")");
        }

        let order = match input.cursor {
            Some(QueryTxInputCursor::Left(ref id)) => {
                query
                    .push(" and (")
                    .push("( t.date = (select date from transactions where id = ")
                    .push_bind(id.to_owned())
                    .push(")")
                    .push(" and t.id > ")
                    .push_bind(id.to_owned())
                    .push(")")
                    .push(" or t.date > (select date from transactions where id = ")
                    .push_bind(id)
                    .push(")")
                    .push(")");

                "asc"
            }
            Some(QueryTxInputCursor::Right(ref id)) => {
                query
                    .push(" and (")
                    .push("( t.date = (select date from transactions where id = ")
                    .push_bind(id.to_owned())
                    .push(")")
                    .push(" and t.id < ")
                    .push_bind(id.to_owned())
                    .push(")")
                    .push(" or t.date < (select date from transactions where id = ")
                    .push_bind(id)
                    .push(")")
                    .push(")");

                "desc"
            }
            None => "desc",
        };

        query
            .push(" order by t.date ")
            .push(order)
            .push(", t.id ")
            .push(order);

        let limit = input.limit.unwrap_or(100) + 1;
        query.push(" limit ").push(limit);

        let mut rows = query.build().fetch_all(&self.pg_pool).await?;

        let mut tx_map: IndexMap<String, QueryTx> = IndexMap::default();

        let has_more = rows.len() == limit as usize;
        if has_more {
            rows.pop();
        }

        match input.cursor {
            Some(QueryTxInputCursor::Left(_)) => rows.reverse(),
            _ => {}
        }

        for row in rows {
            let id: &str = row.try_get("id").expect("id");

            let tx = tx_map.get_mut(id);

            if let Some(tx) = tx {
                let link_id: Option<String> = row.try_get("l_id").expect("l_id");

                if let Some(l_id) = link_id {
                    let created_at: DateTime<Utc> =
                        row.try_get("link_created_at").expect("link_created_at");
                    let updated_at: Option<DateTime<Utc>> =
                        row.try_get("link_updated_at").expect("link_updated_at");

                    let date: DateTime<Utc> = row.try_get("l_date").expect("l_date");
                    let counter_party: String =
                        row.try_get("l_counter_party").expect("l_counter_party");
                    let additional: Option<String> =
                        row.try_get("l_additional").expect("l_additional");
                    let currency: String = row.try_get("l_currency").expect("l_currency");
                    let amount: f32 = row.try_get("l_amount").expect("l_amount");

                    tx.links.push(Link {
                        created_at,
                        updated_at,
                        tx: LinkedTx {
                            id: l_id,
                            date,
                            counter_party,
                            additional,
                            currency,
                            amount,
                        },
                    });
                }
            } else {
                let date: DateTime<Utc> = row.try_get("date").expect("date");
                let counter_party: String = row.try_get("counter_party").expect("counter_party");
                let amount: f32 = row.try_get("amount").expect("amount");
                let additional: Option<String> = row.try_get("additional").expect("additional");
                let currency: String = row.try_get("currency").expect("currency");

                let category_id: Option<String> = row.try_get("category_id").expect("category_id");
                let account_id: Option<String> = row.try_get("account_id").expect("account_id");

                tx_map.insert(
                    id.to_owned(),
                    QueryTx {
                        id: id.to_owned(),
                        date,
                        counter_party,
                        amount,
                        additional,
                        currency,
                        links: vec![],
                        account: if let Some(acc_id) = account_id {
                            let name: String = row.try_get("account_name").expect("account_name");

                            Some(Account { id: acc_id, name })
                        } else {
                            None
                        },
                        category: if let Some(cat_id) = category_id {
                            let name: String = row.try_get("c_name").expect("c_name");
                            let is_neutral: bool =
                                row.try_get("c_is_neutral").expect("c_is_neutral");

                            Some(Category {
                                id: cat_id,
                                name,
                                is_neutral,
                            })
                        } else {
                            None
                        },
                    },
                );
            }
        }

        let vec: Vec<QueryTx> = tx_map.into_values().collect();

        let (next_id, prev_id) = if let [first, _second, ..] = &vec[..] {
            let first_id = first.id.to_owned();
            let last_id = vec.last().expect("last").id.to_owned();

            let (next_id, prev_id) = match (has_more, input.cursor) {
                (true, None) => (Some(last_id), None),
                (false, None) => (None, None),
                (true, Some(_)) => (Some(last_id), Some(first_id)),
                (false, Some(QueryTxInputCursor::Left(_))) => (Some(last_id), None),
                (false, Some(QueryTxInputCursor::Right(_))) => (None, Some(first_id)),
            };
            (next_id, prev_id)
        } else {
            (None, None)
        };

        Ok(TransactionsQueryOutput {
            next_id,
            prev_id,
            transactions: vec,
        })
    }

    pub async fn import_tx_phase_2(
        &self,
        user_id: &str,
        import_id: &str,
    ) -> Result<(), anyhow::Error> {
        let mut tx = self
            .pg_pool
            .begin()
            .await
            .context("error starting transaction")?;

        sqlx::query!(
            r#"
            update transaction_imports ti
            set category_id = tc.id
            from transaction_categories tc
            where ti.import_id = $2
              and ti.user_id = tc.user_id
              and ti.category_name is not null
              and lower(ti.category_name) = lower(tc.name)
              and ti.user_id = $1;
            "#,
            user_id,
            import_id
        )
        .execute(&mut *tx)
        .await
        .context("error updating category_ids")?;

        // TODO: figure out the lower calls
        sqlx::query(
            r#"
            with cats as (
                select distinct on (lower(ti.category_name))
                    ti.category_id,
                    ti.category_name
                from transaction_imports ti
                where ti.import_id = $4
                    and ti.user_id = $1
                    and ti.category_id is not null
                    and ti.category_name is not null
            )

            insert into transaction_categories (
                id, user_id, created_at, updated_at,
                name, is_neutral
            )
            select
                cats.category_id,
                $1,
                $2,
                $3,
                lower(cats.category_name),
                false
            from cats
            where cats.category_id is not null
              and cats.category_name is not null
            on conflict (user_id, lower(name))
            do update set
                updated_at = $2,
                name = excluded.name,
                is_neutral = false
            returning transaction_categories.id;
            "#,
        )
        .bind(user_id)
        .bind(Utc::now())
        .bind(None::<DateTime<Utc>>)
        .bind(import_id)
        .execute(&mut *tx)
        .await
        .context("error inserting categories")?;

        sqlx::query!(
            r#"
            insert into transactions (
                id, user_id, account_id, date, amount,
                currency, counter_party, og_counter_party,
                additional, category_id, created_at
            )
            select
                id, user_id, account_id, date, amount,
                currency, counter_party, og_counter_party,
                additional, category_id, created_at
            from transaction_imports
            where user_id = $1 and import_id = $2
            on conflict (id) do nothing
            "#,
            user_id,
            import_id
        )
        .execute(&mut *tx)
        .await
        .context("error inserting transactions")?;

        tx.commit().await.context("error committing transaction")?;

        Ok(())
    }

    pub async fn import_tx<T: AsyncRead + Unpin>(
        &self,
        user_id: &str,
        source: T,
    ) -> Result<(), anyhow::Error> {
        let mut conn = self
            .pg_pool
            .acquire()
            .await
            .context("error acquiring connection")?;

        let mut copy_in = conn
            .copy_in_raw(
                r#"
                COPY transaction_imports (
                    id,
                    user_id,
                    created_at,

                    date,
                    amount,
                    currency,
                    counter_party,
                    og_counter_party,
                    additional,
                    account_id,
                    category_name,
                    category_id
                ) FROM STDIN WITH (FORMAT CSV)
                "#,
            )
            .await?;

        copy_in
            .read_from(source)
            .await
            .context("error reading from source")?;

        copy_in.finish().await.context("error finishing copy")?;

        conn.close().await.context("error closing connection")?;

        let mut tx = self
            .pg_pool
            .begin()
            .await
            .context("error starting transaction")?;

        // TODO: figure out the lower calls
        sqlx::query(
            r#"
            with cats as (
                select distinct on (lower(ti.category_name))
                    ti.category_id,
                    ti.category_name
                from transaction_imports ti
                where ti.user_id = $1
                  and ti.category_id is not null
                  and ti.category_name is not null
            )

            insert into transaction_categories (
                id, user_id, created_at, updated_at,
                name, is_neutral
            )
            select
                cats.category_id,
                $1,
                $2,
                $3,
                lower(cats.category_name),
                false
            from cats
            where cats.category_id is not null
              and cats.category_name is not null
            on conflict (user_id, lower(name))
            do update set
                updated_at = $2,
                name = excluded.name,
                is_neutral = false
            returning transaction_categories.id;
            "#,
        )
        .bind(user_id)
        .bind(Utc::now())
        .bind(None::<DateTime<Utc>>)
        .execute(&mut *tx)
        .await
        .context("error inserting categories")?;

        sqlx::query!(
            r#"
            update transaction_imports ti
            set category_id = tc.id
            from transaction_categories tc
            where ti.user_id = tc.user_id
              and ti.category_name is not null
              and lower(ti.category_name) = lower(tc.name)
              and ti.user_id = $1;
            "#,
            user_id
        )
        .execute(&mut *tx)
        .await
        .context("error updating category_ids")?;

        sqlx::query!(
            r#"
            insert into transactions (
                id, user_id, account_id, date, amount,
                currency, counter_party, og_counter_party,
                additional, category_id, created_at
            )
            select
                id, user_id, account_id, date, amount,
                currency, counter_party, og_counter_party,
                additional, category_id, created_at
            from transaction_imports
            where user_id = $1
            on conflict (id) do nothing
            "#,
            user_id
        )
        .execute(&mut *tx)
        .await
        .context("error inserting transactions")?;

        tx.commit().await.context("error committing transaction")?;

        Ok(())
    }

    pub async fn get_transactions_by_account_for_sync(
        &self,
        user_id: &str,
        account_id: &str,
    ) -> Result<Vec<SyncTx>, sqlx::Error> {
        let rows = query_as!(
            SyncTx,
            r#"
            select
                t.date,
                t.og_counter_party,
                t.amount as amount
            from transactions t
            where t.user_id = $1 and t.account_id = $2
            "#,
            user_id,
            account_id
        )
        .fetch_all(&self.pg_pool)
        .await?;

        Ok(rows)
    }

    pub async fn insert_many_transactions(
        &self,
        user_id: &str,
        account_id: &str,
        transactions: Vec<InsertTx>,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let updated_at: Option<DateTime<Utc>> = None;

        let mut builder: QueryBuilder<Postgres> = QueryBuilder::new(
            r#"
                insert into transactions (
                    user_id,
                    id,
                    created_at,
                    updated_at,
                    date,
                    amount,
                    currency,
                    counter_party,
                    og_counter_party,
                    additional,
                    account_id
                )
            "#,
        );

        builder.push_values(transactions, |mut b, tx| {
            b.push_bind(user_id);
            b.push_bind(tx.id);
            b.push_bind(now);
            b.push_bind(updated_at);
            b.push_bind(tx.date);
            b.push_bind(tx.amount);
            b.push_bind(tx.currency);
            b.push_bind(tx.counter_party);
            b.push_bind(tx.og_counter_party);
            b.push_bind(tx.additional);
            b.push_bind(account_id);
        });

        let query = builder.build();
        query.execute(&self.pg_pool).await?;

        Ok(())
    }

    pub async fn insert_tx(
        &self,
        user_id: &str,
        tx: &InsertTx,
        account_id: String,
        category_id: Option<String>,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let tx_id = create_id();

        query!(
            r#"
            insert into transactions (
                id,
                user_id,
                created_at,
                updated_at,
                date,
                amount,
                currency,
                counter_party,
                og_counter_party,
                additional,
                account_id,
                category_id
            )
            values (
                $1, $2, $3, $3, $4, $5, $6, $7, $7, $8, $9, $10
            )
            "#,
            tx_id,            // $1
            user_id,          // $2
            now,              // $3
            tx.date,          // $4
            tx.amount,        // $5
            tx.currency,      // $6
            tx.counter_party, // $7
            tx.additional,    // $8
            account_id,       // $9
            category_id,      // $10
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn update_tx_2<'a>(
        &self,
        user_id: &str,
        tx_id: &str,
        input: &UpdateTx<'a>,
        account: String,
        category: Option<String>,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();

        let new_account_id = create_id();
        let new_category_id = create_id();

        query!(
            r#"
            with
            account_check as (
                select 
                    id,
                    case when id = $1 then true else false end as is_id
                from accounts 
                where (id = $1 or name = $1) and user_id = $2
            ),
            account_upsert as (
                insert into accounts (
                    id,
                    user_id,
                    created_at,
                    updated_at,
                    external_id,
                    name
                )
                select 
                    $11, $2, $3, $3, null, $1::text
                where 
                    not exists (select 1 from account_check where is_id = true) and
                    not exists (select 1 from accounts where name = $1 and user_id = $2)
                on conflict (user_id, name)
                do update set 
                    updated_at = excluded.updated_at
                returning id
            ),
            category_check as (
                select 
                    id,
                    case when id = $4 then true else false end as is_id
                from transaction_categories
                where (id = $4 or lower(name) = lower($4)) and user_id = $2
                union all
                select null::text, false where $4 is null
            ),
            category_upsert as (
                insert into transaction_categories (
                    id,
                    user_id,
                    created_at,
                    updated_at,
                    is_neutral,
                    name
                )
                select 
                    $12, $2, $3, $3, false, $4::text
                where 
                    $4 is not null and
                    not exists (select 1 from category_check where is_id = true) and
                    not exists (select 1 from transaction_categories where lower(name) = lower($4) and user_id = $2)
                on conflict (user_id, lower(name))
                do update set 
                    updated_at = excluded.updated_at
                returning id
            )
            update transactions
            set
                updated_at = $3,
                date = $5,
                amount = $6,
                currency = $7,
                counter_party = $8,
                additional = $9,
                category_id = coalesce(
                    (select id from category_check where is_id = true),
                    (select id from category_check where is_id = false and id is not null),
                    (select id from category_upsert)
                ),
                account_id = coalesce(
                    (select id from account_check where is_id = true),
                    (select id from account_check where is_id = false and id is not null),
                    (select id from account_upsert)
                )
            where id = $10 and user_id = $2
            "#,
            account,                         // $1
            user_id,                         // $2
            now,                             // $3
            category as Option<String>,      // $4
            input.date,                      // $5
            input.amount,                    // $6
            input.currency,                  // $7
            input.counter_party,             // $8
            input.additional,                // $9
            tx_id,                           // $10
            new_account_id,                  // $11
            new_category_id,                 // $12
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn delete_tx(&self, user_id: &str, tx_id: &str) -> Result<(), sqlx::Error> {
        query!(
            r#"
            delete from transactions
            where user_id = $1 and id = $2
            "#,
            user_id,
            tx_id
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn tx_stats(
        &self,
        user_id: &str,
        timezone: &str,
        start: &DateTime<Utc>,
        end: &DateTime<Utc>,
    ) -> Result<HashMap<String, Tx>, sqlx::Error> {
        let mut rows = query_as!(
            TxRow,
            r#"
            select
                t.id as id,
                t.date as date,
                t.counter_party as counter_party,
                t.amount as amount,
                t.category_id as category_id,
                t.additional as additional,
                t.currency as currency,
                c.name as "cat_name?",
                c.is_neutral as "cat_is_ne?",

                linked.id as "linked_id?",
                linked.amount as "linked_amount?"
            from transactions t
            left join transaction_categories c on t.category_id = c.id

            left join transactions_links link on link.transaction_a_id = t.id or link.transaction_b_id = t.id
            left join transactions linked on (
                link.transaction_b_id = linked.id and link.transaction_a_id = t.id
            ) or (
                link.transaction_a_id = linked.id and link.transaction_b_id = t.id
            )

            -- left join transactions_links link
            --   on link.transaction_a_id = t.id or link.transaction_b_id = t.id
            -- left join transactions linked
            --   on (linked.id = CASE WHEN link.transaction_a_id = t.id THEN link.transaction_b_id ELSE link.transaction_a_id END)

            where t.user_id = $1
            and t.date at time zone $2 between $3 and $4;
            "#,
            user_id,
            timezone,
            start.naive_utc(),
            end.naive_utc()
        )
        .fetch(&self.pg_pool);

        let mut tx_map: HashMap<String, Tx> = HashMap::default();

        while let Some(row) = rows.try_next().await? {
            let tx = tx_map.get_mut(&row.id);

            if let Some(tx) = tx {
                if let Some(linked_id) = row.linked_id {
                    tx.links.push(linked_id);
                }
            } else {
                tx_map.insert(
                    row.id.to_owned(),
                    Tx {
                        id: row.id,
                        date: row.date,
                        counter_party: row.counter_party,
                        amount: row.amount,
                        additional: row.additional,
                        currency: row.currency,
                        links: vec![],
                        category: if let Some(cat_id) = row.category_id {
                            Some(Category {
                                id: cat_id,
                                name: row.cat_name.expect("checked cat_name"),
                                is_neutral: row.cat_is_ne.expect("checked is_ne"),
                            })
                        } else {
                            None
                        },
                    },
                );
            }
        }

        return Ok(tx_map);
    }

    pub async fn link_tx(
        &self,
        user_id: &str,
        tx_a_id: &str,
        tx_b_id: &str,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let updated_at: Option<DateTime<Utc>> = None;

        query!(
            r#"
            with existing as (
                select user_id from transactions_links
                where user_id = $1
                and (
                    (transaction_a_id = $2 and transaction_b_id = $3)
                    or (transaction_a_id = $3 and transaction_b_id = $2)
                )
            )
            insert into transactions_links (
                user_id,
                created_at,
                updated_at,
                transaction_a_id,
                transaction_b_id
            )
            select $1, $4, $5, $2, $3
            where not exists (select 1 from existing);
            "#,
            user_id,
            tx_a_id,
            tx_b_id,
            now,
            updated_at
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn unlink_tx(
        &self,
        user_id: &str,
        tx1_id: &str,
        tx2_id: &str,
    ) -> Result<(), sqlx::Error> {
        query!(
            r#"
            delete from transactions_links
            where user_id = $1
            and (
                (transaction_a_id = $2 and transaction_b_id = $3)
                or (transaction_a_id = $3 and transaction_b_id = $2)
            )
            "#,
            user_id,
            tx1_id,
            tx2_id,
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn tx_bulk_actions(
        &self,
        user_id: &str,
        tx_ids: Vec<String>,
        category_id: &str,
    ) -> Result<(), sqlx::Error> {
        query!(
            r#"
            update transactions
            set
                updated_at = $3,
                category_id = $2
            where user_id = $1 and id = ANY($4)
            "#,
            user_id,
            category_id,
            Utc::now(),
            &tx_ids[..]
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn insert_account(
        &self,
        user_id: &str,
        account_id: &str,
        name: &str,
    ) -> Result<(), sqlx::Error> {
        let created_at = Utc::now();
        let updated_at: Option<DateTime<Utc>> = None;

        query!(
            r#"
            insert into accounts
            (id, user_id, created_at, updated_at, external_id, name)
            values ($1, $2, $3, $4, $5, $6)
            "#,
            account_id,
            user_id,
            created_at,
            updated_at,
            None::<String>,
            name
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn get_user_id_by_external_id(&self, external_id: &str) -> Result<Option<String>> {
        let id = query!("select id from users where external_id = $1", external_id)
            .fetch_optional(&self.pg_pool)
            .await
            .context("error getting user id by external id")?;

        return Ok(id.map(|row| row.id));
    }

    pub async fn upsert_user_with_session(&self, user: &User, session: &Session) -> Result<()> {
        let mut tx = self.pg_pool.begin().await.context("error starting tx")?;

        query!(
            "insert into users (id, external_id, locale, created_at, updated_at) values ($1, $2, $3, $4, $5) on conflict (external_id) do nothing;",
            user.id,
            user.external_id,
            user.locale,
            user.created_at,
            user.updated_at
        )
            .execute(&mut *tx)
            .await
            .context("error upserting user")?;

        query!(
            "insert into sessions (id, user_id, created_at, updated_at) values ($1, $2, $3, $4)",
            session.id,
            user.id,
            session.created_at,
            session.updated_at,
        )
        .execute(&mut *tx)
        .await
        .context("error inserting session")?;

        tx.commit().await.context("error committing tx")?;

        return Ok(());
    }

    pub async fn get_session(
        &self,
        user_id: &str,
        session_id: &str,
    ) -> Result<Option<Session>, sqlx::Error> {
        let session = query_as!(
            Session,
            "select id, user_id, created_at, updated_at from sessions where id = $1 and user_id = $2 limit 1;",
            session_id,
            user_id,
        )
        .fetch_optional(&self.pg_pool)
        .await?;

        return Ok(session);
    }

    pub async fn insert_session(&self, user_id: &str, session_id: &str) -> Result<(), sqlx::Error> {
        let created_at = Utc::now();
        let updated_at: Option<DateTime<Utc>> = None;

        query!(
            "insert into sessions (id, user_id, created_at, updated_at) values ($1, $2, $3, $4)",
            session_id,
            user_id,
            created_at,
            updated_at
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn get_user_bank_integrations(
        &self,
        user_id: &str,
    ) -> Result<Vec<UserBankIntergration>, sqlx::Error> {
        let rows = query_as!(
            UserBankIntergration,
            "select name, data from user_bank_integrations where user_id = $1",
            user_id
        )
        .fetch_all(&self.pg_pool)
        .await?;

        Ok(rows)
    }

    pub async fn get_one_user_bank_integration(
        &self,
        user_id: &str,
        name: &str,
    ) -> Result<Option<UserBankIntergration>, sqlx::Error> {
        let row = query_as!(
            UserBankIntergration,
            "select name, data from user_bank_integrations where user_id = $1 and name = $2",
            user_id,
            name
        )
        .fetch_optional(&self.pg_pool)
        .await?;

        Ok(row)
    }

    pub async fn set_user_bank_integration(
        &self,
        user_id: &str,
        name: &str,
        data: Value,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let updated_at: Option<DateTime<Utc>> = Some(now);

        query!(
            r#"
            insert into user_bank_integrations (user_id, created_at, updated_at, name, data)
            values ($1, $2, $3, $4, $5)
            on conflict (user_id, name)
            do update
            set
                updated_at = $3,
                data = $5
            "#,
            user_id,
            now,
            updated_at,
            name,
            data
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn set_user_bank_integration_with_accounts(
        &self,
        user_id: &str,
        name: &str,
        data: Value,
        account_ids: Vec<String>,
    ) -> Result<(), anyhow::Error> {
        let mut tx = self
            .pg_pool
            .begin()
            .await
            .context("error starting transaction")?;

        let now = Utc::now();
        let updated_at: Option<DateTime<Utc>> = Some(now);

        query!(
            r#"
            insert into user_bank_integrations (user_id, created_at, updated_at, name, data)
            values ($1, $2, $3, $4, $5)
            on conflict (user_id, name)
            do update
            set
                updated_at = $3,
                data = $5
            "#,
            user_id,
            now,
            updated_at,
            name,
            data
        )
        .execute(&mut *tx)
        .await?;

        for account_id in account_ids {
            query!(
                r#"
                insert into accounts (id, user_id, created_at)
                values ($1, $2, $3)
                on conflict (user_id, id)
                do nothing;
                "#,
                account_id,
                user_id,
                now
            )
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await.context("error committing transaction")?;

        Ok(())
    }

    pub async fn delete_user_bank_integration(
        &self,
        user_id: &str,
        name: &str,
    ) -> Result<(), sqlx::Error> {
        query!(
            r#"
            delete from user_bank_integrations
            where user_id = $1 and name = $2
            "#,
            user_id,
            name
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, ToSchema, FromRow)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub is_neutral: bool,
}

#[derive(Debug, Clone, Serialize, ToSchema, FromRow)]
pub struct CategoryWithCounts {
    pub id: String,
    pub name: String,
    pub is_neutral: bool,
    pub tx_count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Account {
    pub id: String,
    pub name: String,
}

#[derive(Debug, FromRow)]
struct QueryTxRow {
    id: String,
    date: DateTime<Utc>,
    amount: f32,
    counter_party: String,
    additional: Option<String>,
    currency: String,
    category_id: Option<String>,

    cat_name: Option<String>,
    cat_is_ne: Option<bool>,

    link_created_at: Option<DateTime<Utc>>,
    link_updated_at: Option<DateTime<Utc>>,

    l_id: Option<String>,
    l_date: Option<DateTime<Utc>>,
    l_amount: Option<f32>,
    l_counter_party: Option<String>,
    l_additional: Option<String>,
    l_currency: Option<String>,
    l_category_id: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct QueryTx {
    pub id: String,
    pub date: DateTime<Utc>,
    pub amount: f32,
    pub counter_party: String,
    pub additional: Option<String>,
    pub currency: String,
    pub category: Option<Category>,
    pub account: Option<Account>,
    pub links: Vec<Link>,
}

pub struct User {
    pub id: String,
    pub external_id: String,
    pub locale: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Link {
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
    pub tx: LinkedTx,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LinkedTx {
    pub id: String,
    pub date: DateTime<Utc>,
    pub counter_party: String,
    pub additional: Option<String>,
    pub currency: String,
    pub amount: f32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SyncTx {
    pub og_counter_party: String,
    pub date: DateTime<Utc>,
    pub amount: f32,
}

#[derive(Debug)]
pub struct InsertTx {
    pub id: String,
    pub date: DateTime<Utc>,
    pub counter_party: String,
    pub og_counter_party: String,
    pub additional: Option<String>,
    pub currency: String,
    pub amount: f32,
}

#[derive(Debug, FromRow)]
struct TxRow {
    id: String,
    date: DateTime<Utc>,
    amount: f32,
    counter_party: String,
    additional: Option<String>,
    currency: String,
    category_id: Option<String>,
    cat_name: Option<String>,
    cat_is_ne: Option<bool>,

    linked_id: Option<String>,
    linked_amount: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct Tx {
    pub id: String,
    pub date: DateTime<Utc>,
    pub counter_party: String,
    pub additional: Option<String>,
    pub currency: String,
    pub category: Option<Category>,
    pub amount: f32,
    pub links: Vec<String>,
}

#[derive(Debug)]
pub struct UpdateTx<'a> {
    pub date: DateTime<Utc>,
    pub counter_party: &'a str,
    pub additional: Option<&'a str>,
    pub currency: &'a str,
    pub amount: f32,
}

pub struct UserBankIntergration {
    pub name: String,
    pub data: Value,
}

#[derive(Debug)]
pub struct QueryTxInput {
    pub search_text: Option<String>,
    pub cursor: Option<QueryTxInputCursor>,
    pub limit: Option<i8>,
}

#[derive(Debug)]
pub enum QueryTxInputCursor {
    Left(String),
    Right(String),
}

pub enum IdentifierSpec {
    Id(String),
    Name(String),
}
