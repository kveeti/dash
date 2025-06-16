use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{query, query_as};
use utoipa::ToSchema;

use super::Data;

impl Data {
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

    pub async fn get_accounts(
        &self,
        user_id: &str,
    ) -> Result<Vec<AccountWithExternal>, sqlx::Error> {
        let rows = query_as!(
            AccountWithExternal,
            "select id, name, external_id from accounts where user_id = $1",
            user_id
        )
        .fetch_all(&self.pg_pool)
        .await?;

        Ok(rows)
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Account {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AccountWithExternal {
    pub id: String,
    pub name: String,
    pub external_id: Option<String>,
}
