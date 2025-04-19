use anyhow::{Context, Result};
use postgres::Postgres;

use crate::config::Config;

mod postgres;
pub use postgres::{Session, User};

mod id;
pub use id::create_id;

#[derive(Clone)]
pub struct Data {
    pub users: postgres::Users,
    pub sessions: postgres::Sessions,
}

impl Data {
    pub async fn new(config: &Config) -> Result<Self> {
        let postgres = Postgres::new(&config.database_url)
            .await
            .context("error creating postgres")?;

        return Ok(Self {
            users: postgres.users,
            sessions: postgres.sessions,
        });
    }
}
