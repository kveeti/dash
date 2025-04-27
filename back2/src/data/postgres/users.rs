use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::query;

use super::{Pool, Session};

#[derive(Clone)]
pub struct Users {
    pool: Pool,
}

impl Users {
    pub(crate) fn new(pool: Pool) -> Self {
        return Self { pool };
    }

    pub async fn upsert_with_session(&self, user: &User, session: &Session) -> Result<()> {
        let mut tx = self.pool.begin().await.context("error starting tx")?;

        query!(
            "insert into users (id, external_id, locale, created_at, updated_at) values ($1, $2, $3, $4, $5) on conflict (external_id) do nothing;",
            user.id,
            user.external_id,
            user.locale,
            user.created_at,
            user.updated_at
        )
            .execute(&mut *tx)
            .await
            .context("error upserting user")?;

        query!(
            "insert into sessions (id, user_id, created_at, updated_at) values ($1, $2, $3, $4)",
            session.id,
            user.id,
            session.created_at,
            session.updated_at,
        )
        .execute(&mut *tx)
        .await
        .context("error inserting session")?;

        tx.commit().await.context("error committing tx")?;

        return Ok(());
    }
}

pub struct User {
    pub id: String,
    pub external_id: String,
    pub locale: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}
