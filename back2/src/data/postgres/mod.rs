use anyhow::{Context, Result};
use sqlx::PgPool;

mod users;
pub use users::*;

mod sessions;
pub use sessions::*;

type Pool = PgPool;
pub struct Postgres {
    pub users: Users,
    pub sessions: Sessions,
}

impl Postgres {
    pub async fn new(url: &str) -> Result<Self> {
        let pool = PgPool::connect(url)
            .await
            .context("error connecting to postgres")?;

        return Ok(Self {
            users: Users::new(pool.clone()),
            sessions: Sessions::new(pool.clone()),
        });
    }
}
