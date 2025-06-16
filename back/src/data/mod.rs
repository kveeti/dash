use anyhow::{Context, Result};
use sqlx::{PgPool, migrate};
use tracing::info;

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

#[derive(Clone)]
pub struct Data {
    pg_pool: sqlx::PgPool,
}

impl Data {
    pub async fn new(config: &Config) -> Result<Self> {
        info!("connecting to db...");

        let pg = PgPool::connect(&config.database_url)
            .await
            .context("error connecting to postgres")?;

        info!("connected to db, running migrations...");

        migrate!()
            .run(&pg)
            .await
            .context("error running migrations")?;

        info!("migrations completed");

        return Ok(Self {
            pg_pool: pg.clone(),
        });
    }

    pub fn get_pg_pool(self) -> sqlx::PgPool {
        return self.pg_pool;
    }
}
