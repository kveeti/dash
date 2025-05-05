use anyhow::{Context, Result};
use postgres::Postgres;
use serde::Serialize;
use sqlx::query_as;
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
                "select id, name from transaction_categories where user_id = $1 and name ilike $2",
                user_id,
                format!("%{}%", search_text)
            )
            .fetch_all(&self.pg_pool)
            .await?
        } else {
            query_as!(
                Category,
                "select id, name from transaction_categories where user_id = $1",
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
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Category {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Account {
    pub id: String,
    pub name: String,
}
