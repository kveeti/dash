use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{query, query_as};

use super::Pool;

#[derive(Clone)]
pub struct UserBankIntegrations {
    pool: Pool,
}

impl UserBankIntegrations {
    pub(crate) fn new(pool: Pool) -> Self {
        return Self { pool };
    }

    pub async fn get_by_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<UserBankIntergration>, sqlx::Error> {
        let rows = query_as!(
            UserBankIntergration,
            "select name, data from user_bank_integrations where user_id = $1",
            user_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    pub async fn get(
        &self,
        user_id: &str,
        name: &str,
    ) -> Result<Option<UserBankIntergration>, sqlx::Error> {
        let row = query_as!(
            UserBankIntergration,
            "select name, data from user_bank_integrations where user_id = $1 and name = $2",
            user_id,
            name
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row)
    }

    pub async fn set(&self, user_id: &str, name: &str, data: Value) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let updated_at: Option<DateTime<Utc>> = Some(now);

        query!(
            r#"
            insert into user_bank_integrations (user_id, created_at, updated_at, name, data)
            values ($1, $2, $3, $4, $5)
            on conflict (user_id, name)
            do update
            set
                updated_at = $3,
                data = $5
            "#,
            user_id,
            now,
            updated_at,
            name,
            data
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}

pub struct UserBankIntergration {
    pub name: String,
    pub data: Value,
}
