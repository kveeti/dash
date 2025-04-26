use anyhow::{Context, Result};
use postgres::Postgres;

use crate::config::Config;

mod postgres;
pub use postgres::*;

mod id;
pub use id::create_id;

#[derive(Clone)]
pub struct Data {
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
            users: postgres.users,
            sessions: postgres.sessions,
            transactions: postgres.transactions,
            user_bank_integrations: postgres.user_bank_integrations,
        });
    }
}
