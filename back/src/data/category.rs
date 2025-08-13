use chrono::{DateTime, Utc};
use sqlx::{QueryBuilder, query};

use crate::data::{TxCategory, TxCategoryWithCounts};

use super::Data;

impl Data {
    #[tracing::instrument(skip(self))]
    pub async fn query_categories_with_counts(
        &self,
        user_id: &str,
        search_text: &Option<String>,
    ) -> Result<Vec<TxCategoryWithCounts>, sqlx::Error> {
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

        let query = qb.build_query_as::<TxCategoryWithCounts>();
        let rows = query.fetch_all(&self.pg_pool).await?;

        Ok(rows)
    }

    #[tracing::instrument(skip(self))]
    pub async fn query_categories(
        &self,
        user_id: &str,
        search_text: &Option<String>,
    ) -> Result<Vec<TxCategory>, sqlx::Error> {
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

        let query = qb.build_query_as::<TxCategory>();
        let rows = query.fetch_all(&self.pg_pool).await?;

        Ok(rows)
    }

    #[tracing::instrument(skip(self))]
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

    #[tracing::instrument(skip(self))]
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

    #[tracing::instrument(skip(self))]
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
}
