use anyhow::{Context, Result};
use sqlx::PgPool;

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
mod settings;
pub use settings::*;
mod import;
pub use import::*;

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
}
