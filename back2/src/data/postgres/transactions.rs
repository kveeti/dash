use std::collections::HashMap;

use chrono::{DateTime, Utc};
use futures::TryStreamExt;
use sqlx::{prelude::FromRow, query, query_as};

use crate::data::create_id;

use super::Pool;

#[derive(Clone)]
pub struct Transactions {
    pool: Pool,
}

impl Transactions {
    pub(crate) fn new(pool: Pool) -> Self {
        return Self { pool };
    }

    pub async fn insert_with_category<'a>(
        &self,
        user_id: &str,
        tx: &InsertTx<'a>,
        category_name: &str,
    ) -> Result<(), sqlx::Error> {
        let category_id = create_id();
        let now = Utc::now();
        let updated_at: Option<DateTime<Utc>> = None;

        query!(
            r#"
            with category_id as (
                insert into transaction_categories (
                    user_id,
                    id,
                    created_at,
                    updated_at,
                    name,
                    is_neutral
                )
                values ($1, $2, $3, $4, $5, false)
                on conflict (user_id, lower(name))
                do update set name = excluded.name
                returning id
            )
            insert into transactions (
                user_id,
                id,
                created_at,
                updated_at,
                date,
                amount,
                currency,
                counter_party,
                additional,
                category_id
            )
            values ($1, $6, $3, $4, $7, $8, $9, $10, $11, coalesce((select id from category_id), $2))
            "#,
            user_id,
            category_id,
            now,
            updated_at,
            category_name,
            tx.id,
            tx.date,
            tx.amount,
            tx.currency,
            tx.counter_party,
            tx.additional,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn insert<'a>(&self, user_id: &str, tx: &InsertTx<'a>) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let updated_at: Option<DateTime<Utc>> = None;

        query!(
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
                additional
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
            user_id,
            tx.id,
            now,
            updated_at,
            tx.date,
            tx.amount,
            tx.currency,
            tx.counter_party,
            tx.additional
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn update<'a>(
        &self,
        user_id: &str,
        tx_id: &str,
        tx: &UpdateTx<'a>,
    ) -> Result<(), sqlx::Error> {
        query!(
            r#"
            update transactions
            set
                updated_at = $3,
                date = $4,
                amount = $5,
                currency = $6,
                counter_party = $7,
                additional = $8
            where user_id = $1 and id = $2
            "#,
            user_id,
            tx_id,
            Utc::now(),
            tx.date,
            tx.amount,
            tx.currency,
            tx.counter_party,
            tx.additional
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn update_with_category<'a>(
        &self,
        user_id: &str,
        tx_id: &str,
        tx: &UpdateTx<'a>,
        category_name: &str,
    ) -> Result<(), sqlx::Error> {
        let category_id = create_id();

        query!(
            r#"
            with category_id as (
                insert into transaction_categories (
                    user_id,
                    created_at,
                    updated_at,
                    name,
                    is_neutral
                )
                values ($1, $2, null, $3, false)
                on conflict (user_id, lower(name))
                do update set name = excluded.name
                returning id
            )
            update transactions
            set
                updated_at = $2,
                date = $5,
                amount = $6,
                currency = $7,
                counter_party = $8,
                additional = $9,
                category_id = coalesce((select id from category_id), $4)
            where user_id = $1 and id = $10
            "#,
            user_id,
            Utc::now(),
            category_name,
            category_id,
            tx.date,
            tx.amount,
            tx.currency,
            tx.counter_party,
            tx.additional,
            tx_id
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn delete(&self, user_id: &str, tx_id: &str) -> Result<(), sqlx::Error> {
        query!(
            r#"
            delete from transactions
            where user_id = $1 and id = $2
            "#,
            user_id,
            tx_id
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn stats(
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
                c.name as cat_name,
                c.is_neutral as cat_is_ne,

                linked.id as linked_id,
                linked.amount as linked_amount
            from transactions t
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

            left join transaction_categories c on t.category_id = c.id
            where t.user_id = $1
            and t.date at time zone $2 between $3 and $4;
            "#,
            user_id,
            timezone,
            start.naive_utc(),
            end.naive_utc()
        )
        .fetch(&self.pool);

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

    pub async fn link(
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
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn unlink(
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
        .execute(&self.pool)
        .await?;

        Ok(())
    }
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
pub struct InsertTx<'a> {
    pub id: &'a str,
    pub date: DateTime<Utc>,
    pub counter_party: &'a str,
    pub additional: Option<&'a str>,
    pub currency: &'a str,
    pub amount: f32,
}

#[derive(Debug)]
pub struct UpdateTx<'a> {
    pub date: DateTime<Utc>,
    pub counter_party: &'a str,
    pub additional: Option<&'a str>,
    pub currency: &'a str,
    pub amount: f32,
}

#[derive(Debug, Clone)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub is_neutral: bool,
}
