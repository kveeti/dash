use std::collections::HashMap;

use chrono::{DateTime, Utc};
use futures::TryStreamExt;
use indexmap::IndexMap;
use serde::Serialize;
use sqlx::{Postgres, QueryBuilder, Row, prelude::FromRow, query, query_as};

use crate::{
    data::Account,
    endpoints::transactions::{query::TransactionsQueryOutput, stats::StatsTx},
};

use super::Data;

impl Data {
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
                t.categorize_on as categorize_on,
                t.counter_party as counter_party,
                t.amount as amount,
                t.category_id as category_id,
                t.currency as currency,
                t.additional as additional,
                t.notes as notes,

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
            let id: &str = row.get_unchecked("id");

            let link_id: Option<String> = row.get_unchecked("l_id");

            let tx = tx_map.entry(id.to_owned()).or_insert_with(|| QueryTx {
                id: id.to_owned(),
                date: row.get_unchecked("date"),
                categorize_on: row.get_unchecked("categorize_on"),
                counter_party: row.get_unchecked("counter_party"),
                amount: row.get_unchecked("amount"),
                additional: row.get_unchecked("additional"),
                notes: row.get_unchecked("notes"),
                currency: row.get_unchecked("currency"),
                links: vec![],
                account: if let Some(acc_id) = row.get_unchecked("account_id") {
                    let name: String = row.get_unchecked("account_name");
                    Some(Account { id: acc_id, name })
                } else {
                    None
                },
                category: if let Some(cat_id) = row.get_unchecked("category_id") {
                    let name: String = row.get_unchecked("c_name");
                    let is_neutral: bool = row.get_unchecked("c_is_neutral");
                    Some(TxCategory {
                        id: cat_id,
                        name,
                        is_neutral,
                    })
                } else {
                    None
                },
            });

            if let Some(l_id) = link_id {
                tx.links.push(Link {
                    created_at: row.get_unchecked("link_created_at"),
                    updated_at: row.get_unchecked("link_updated_at"),
                    tx: LinkedTx {
                        id: l_id,
                        date: row.get_unchecked("l_date"),
                        counter_party: row.get_unchecked("l_counter_party"),
                        additional: row.get_unchecked("l_additional"),
                        currency: row.get_unchecked("l_currency"),
                        amount: row.get_unchecked("l_amount"),
                    },
                });
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

    #[tracing::instrument(skip(self))]
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
                t.counter_party,
                t.amount
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

    #[tracing::instrument(skip(self))]
    pub async fn tx_stats(
        &self,
        user_id: &str,
        start: &DateTime<Utc>,
        end: &DateTime<Utc>,
    ) -> Result<HashMap<String, StatsTx>, sqlx::Error> {
        let mut rows = query(
            r#"
            select
                t.id as id,
                coalesce(t.date, t.categorize_on) as date,
                t.counter_party as counter_party,
                t.amount as amount,
                t.category_id as category_id,
                t.additional as additional,
                t.currency as currency,
                c.name as cat_name,
                c.is_neutral as cat_is_ne,

                linked.id as linked_id
            from transactions t
            left join transaction_categories c on t.category_id = c.id

            left join transactions_links link
              on link.transaction_a_id = t.id or link.transaction_b_id = t.id
            left join transactions linked
              on (linked.id = CASE WHEN link.transaction_a_id = t.id THEN link.transaction_b_id ELSE link.transaction_a_id END)

            where t.user_id = $1
            and t.date between $2 and $3
            "#
        )
        .bind(user_id)
        .bind(start)
        .bind(end)
        .fetch(&self.pg_pool);

        let mut tx_map: HashMap<String, StatsTx> = HashMap::default();

        while let Some(row) = rows.try_next().await? {
            let id: String = row.get_unchecked("id");

            let tx = tx_map.entry(id.to_owned()).or_insert_with(|| StatsTx {
                id,
                date: row.get_unchecked("date"),
                counter_party: row.get_unchecked("counter_party"),
                amount: row.get_unchecked("amount"),
                additional: row.get_unchecked("additional"),
                currency: row.get_unchecked("currency"),
                links: vec![],
                category: if let Some(cat_id) = row.get_unchecked("category_id") {
                    Some(TxCategory {
                        id: cat_id,
                        name: row.get_unchecked("cat_name"),
                        is_neutral: row.get_unchecked("cat_is_ne"),
                    })
                } else {
                    None
                },
            });

            if let Some(linked_id) = row.get_unchecked("linked_id") {
                tx.links.push(linked_id);
            }
        }

        return Ok(tx_map);
    }
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct QueryTx {
    pub id: String,
    pub date: DateTime<Utc>,
    pub categorize_on: Option<DateTime<Utc>>,
    pub amount: f32,
    pub counter_party: String,
    pub additional: Option<String>,
    pub notes: Option<String>,
    pub currency: String,
    pub category: Option<TxCategory>,
    pub account: Option<Account>,
    pub links: Vec<Link>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct Link {
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
    pub tx: LinkedTx,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct LinkedTx {
    pub id: String,
    pub date: DateTime<Utc>,
    pub counter_party: String,
    pub additional: Option<String>,
    pub currency: String,
    pub amount: f32,
}

#[derive(Debug)]
pub struct QueryTxInput {
    pub search_text: Option<String>,
    pub limit: Option<i8>,
    pub cursor: Option<QueryTxInputCursor>,
}

#[derive(Debug)]
pub enum QueryTxInputCursor {
    Left(String),
    Right(String),
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct SyncTx {
    pub date: DateTime<Utc>,
    pub counter_party: String,
    pub amount: f32,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct Tx {
    pub id: String,
    pub date: DateTime<Utc>,
    pub categorize_on: Option<DateTime<Utc>>,
    pub amount: f32,
    pub counter_party: String,
    pub additional: Option<String>,
    pub currency: String,
    pub category: Option<TxCategory>,
    pub account: Option<Account>,
    pub links: Vec<TxLink>,
}

#[derive(Debug, Serialize, FromRow)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct TxCategory {
    pub id: String,
    pub name: String,
    pub is_neutral: bool,
}
#[derive(Debug, Clone, Serialize, FromRow)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct TxCategoryWithCounts {
    pub id: String,
    pub name: String,
    pub is_neutral: bool,
    pub tx_count: i64,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct TxLink {
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
    pub tx: TxLinkLinkedTx,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct TxLinkLinkedTx {
    pub id: String,
    pub date: DateTime<Utc>,
    pub counter_party: String,
    pub additional: Option<String>,
    pub currency: String,
    pub amount: f32,
}
