use anyhow::{Context, Result};
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

    pub async fn upsert(&self, input: &User) -> Result<(), sqlx::Error> {
        query!(
            "insert into users (id, external_id) values ($1, $2) on conflict (external_id) do nothing;",
            input.id,
            input.external_id
        )
        .execute(&self.pool)
        .await?;

        return Ok(());
    }

    pub async fn upsert_with_session(&self, user: &User, session: &Session) -> Result<()> {
        let mut tx = self.pool.begin().await.context("error starting tx")?;

        query!(
            "insert into users (id, external_id, locale) values ($1, $2, $3) on conflict (external_id) do nothing;",
            user.id,
            user.external_id,
            user.locale
        )
            .execute(&mut *tx)
            .await
            .context("error upserting user")?;

        query!(
            "insert into sessions (id, user_id) values ($1, $2)",
            session.id,
            user.id
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
}
