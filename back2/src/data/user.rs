use anyhow::Context;
use chrono::{DateTime, Utc};
use sqlx::{query, query_as};

use super::Data;

impl Data {
    pub async fn get_user_id_by_external_id(
        &self,
        external_id: &str,
    ) -> Result<Option<String>, sqlx::Error> {
        let id = query!("select id from users where external_id = $1", external_id)
            .fetch_optional(&self.pg_pool)
            .await?;

        return Ok(id.map(|row| row.id));
    }

    pub async fn upsert_user_with_session(
        &self,
        user: &User,
        session: &Session,
    ) -> Result<(), anyhow::Error> {
        let mut tx = self.pg_pool.begin().await.context("error starting tx")?;

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

    pub async fn get_session(
        &self,
        user_id: &str,
        session_id: &str,
    ) -> Result<Option<Session>, sqlx::Error> {
        let session = query_as!(
            Session,
            "select id, user_id, created_at, updated_at from sessions where id = $1 and user_id = $2 limit 1;",
            session_id,
            user_id,
        )
        .fetch_optional(&self.pg_pool)
        .await?;

        return Ok(session);
    }

    pub async fn insert_session(&self, user_id: &str, session_id: &str) -> Result<(), sqlx::Error> {
        let created_at = Utc::now();
        let updated_at: Option<DateTime<Utc>> = None;

        query!(
            "insert into sessions (id, user_id, created_at, updated_at) values ($1, $2, $3, $4)",
            session_id,
            user_id,
            created_at,
            updated_at
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }
}

pub struct User {
    pub id: String,
    pub external_id: String,
    pub locale: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}
