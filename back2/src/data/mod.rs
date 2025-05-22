use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgPool, query, query_as};
use utoipa::ToSchema;

use crate::config::Config;

mod id;
pub use id::create_id;

mod category;
pub use category::*;
mod user;
pub use user::*;
mod account;
pub use account::*;
mod user_bank_integrations;
pub use user_bank_integrations::*;
mod tx_queries;
pub use tx_queries::*;
mod tx_mutations;
pub use tx_mutations::*;

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

    pub async fn save_settings(
        &self,
        user_id: &str,
        settings: Settings,
    ) -> Result<(), sqlx::Error> {
        query!(
            r#"
            insert into user_settings (user_id, created_at, updated_at, locale)
            values ($1, $2, $3, $4)
            on conflict (user_id)
            do update set
                updated_at = $2,
                locale = excluded.locale
            "#,
            user_id,
            Utc::now(),
            None::<DateTime<Utc>>,
            settings.locale
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn get_settings(&self, user_id: &str) -> Result<Option<Settings>, sqlx::Error> {
        let settings = query_as!(
            Settings,
            r#"
            select (locale) from user_settings
            where user_id = $1
            limit 1;
            "#,
            user_id,
        )
        .fetch_optional(&self.pg_pool)
        .await?;

        Ok(settings)
    }
}

#[derive(Debug, ToSchema, Serialize)]
pub struct Settings {
    pub locale: String,
}
