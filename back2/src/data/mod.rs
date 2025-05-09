use std::collections::HashMap;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use postgres::Postgres;
use serde::Serialize;
use sqlx::{prelude::FromRow, query, query_as};
use tokio::io::AsyncRead;
use utoipa::ToSchema;

use crate::config::Config;

mod postgres;
pub use postgres::*;

mod id;
pub use id::create_id;

#[derive(Clone)]
pub struct Data {
    pg_pool: sqlx::PgPool,
    pub users: postgres::Users,
    pub sessions: postgres::Sessions,
    pub transactions: postgres::Transactions,
    pub user_bank_integrations: postgres::UserBankIntegrations,
}

impl Data {
    pub async fn new(config: &Config) -> Result<Self> {
        let postgres = Postgres::new(&config.database_url)
            .await
            .context("error creating postgres")?;

        return Ok(Self {
            pg_pool: postgres.pool.clone(),
            users: postgres.users,
            sessions: postgres.sessions,
            transactions: postgres.transactions,
            user_bank_integrations: postgres.user_bank_integrations,
        });
    }

    pub async fn queryCategories(
        &self,
        user_id: &str,
        search_text: &Option<String>,
    ) -> Result<Vec<Category>, sqlx::Error> {
        let rows = if let Some(search_text) = search_text {
            query_as!(
                Category,
                "select id, name, is_neutral from transaction_categories where user_id = $1 and name ilike $2",
                user_id,
                format!("%{}%", search_text)
            )
            .fetch_all(&self.pg_pool)
            .await?
        } else {
            query_as!(
                Category,
                "select id, name, is_neutral from transaction_categories where user_id = $1",
                user_id
            )
            .fetch_all(&self.pg_pool)
            .await?
        };

        Ok(rows)
    }

    pub async fn queryAccounts(
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

    pub async fn query_transactions(&self, user_id: &str) -> Result<Vec<QueryTx>, sqlx::Error> {
        let rows = query_as!(
            QueryTxRow,
            r#"
            select
                t.id as id,
                t.date as date,
                t.counter_party as counter_party,
                t.amount as amount,
                t.category_id as category_id,
                t.currency as currency,
                t.additional as additional,

                c.name as "cat_name?",
                c.is_neutral as "cat_is_ne?",

                link.created_at as "link_created_at?",
                link.updated_at as "link_updated_at?",

                linked.id as "l_id?",
                linked.amount as "l_amount?",
                linked.date as "l_date?",
                linked.counter_party as "l_counter_party?",
                linked.additional as "l_additional?",
                linked.currency as "l_currency?",
                linked.category_id as "l_category_id?"
            from transactions t

            left join transaction_categories c on t.category_id = c.id

            left join transactions_links link
              on link.transaction_a_id = t.id or link.transaction_b_id = t.id
            left join transactions linked
              on (linked.id = CASE WHEN link.transaction_a_id = t.id THEN link.transaction_b_id ELSE link.transaction_a_id END)

            where t.user_id = $1
            order by t.date asc
            "#,
            user_id
        )
        .fetch_all(&self.pg_pool)
        .await?;

        let mut tx_map: HashMap<String, QueryTx> = HashMap::default();

        for row in rows {
            let tx = tx_map.get_mut(&row.id);

            if let Some(tx) = tx {
                if let Some(l_id) = row.l_id {
                    tx.links.push(Link {
                        created_at: row.link_created_at.expect("checked created_at"),
                        updated_at: row.link_updated_at.expect("checked updated_at"),
                        tx: LinkedTx {
                            id: l_id,
                            date: row.l_date.expect("checked linked_date"),
                            counter_party: row
                                .l_counter_party
                                .expect("checked linked_counter_party"),
                            additional: row.l_additional,
                            currency: row.l_currency.expect("checked linked_currency"),
                            amount: row.l_amount.expect("checked linked_amount"),
                        },
                    });
                }
            } else {
                tx_map.insert(
                    row.id.to_owned(),
                    QueryTx {
                        id: row.id.clone(),
                        date: row.date.clone(),
                        counter_party: row.counter_party.clone(),
                        amount: row.amount.clone(),
                        additional: row.additional.clone(),
                        currency: row.currency.clone(),
                        links: vec![],
                        category: if let Some(cat_id) = row.category_id.clone() {
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

        let mut result = tx_map
            .into_iter()
            .map(|(_, tx)| tx)
            .collect::<Vec<QueryTx>>();

        result.sort_by(|a, b| b.date.cmp(&a.date));

        Ok(result)
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

    pub async fn import_tx(
        &self,
        user_id: &str,
        source: impl AsyncRead + Unpin,
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
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub is_neutral: bool,
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
    pub links: Vec<Link>,
}
