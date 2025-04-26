use anyhow::{Context, Result};
use sqlx::PgPool;

mod users;
pub use users::*;

mod sessions;
pub use sessions::*;

mod transactions;
pub use transactions::*;

mod user_bank_integrations;
pub use user_bank_integrations::*;

type Pool = PgPool;
pub(crate) struct Postgres {
    pub users: Users,
    pub sessions: Sessions,
    pub transactions: Transactions,
    pub user_bank_integrations: UserBankIntegrations,
}

impl Postgres {
    pub async fn new(url: &str) -> Result<Self> {
        let pool = PgPool::connect(url)
            .await
            .context("error connecting to postgres")?;

        return Ok(Self {
            users: Users::new(pool.clone()),
            sessions: Sessions::new(pool.clone()),
            transactions: Transactions::new(pool.clone()),
            user_bank_integrations: UserBankIntegrations::new(pool.clone()),
        });
    }
}
