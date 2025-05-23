use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{query, query_as};
use utoipa::ToSchema;

use super::Data;

impl Data {
    pub async fn save_settings(
        &self,
        user_id: &str,
        settings: Settings,
    ) -> Result<(), sqlx::Error> {
        query!(
            r#"
            insert into user_settings (user_id, created_at, updated_at, locale, timezone)
            values ($1, $2, $3, $4, $5)
            on conflict (user_id)
            do update set
                updated_at = $2,
                locale = excluded.locale,
                timezone = excluded.timezone
            "#,
            user_id,
            Utc::now(),
            None::<DateTime<Utc>>,
            settings.locale,
            settings.timezone
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn get_settings(&self, user_id: &str) -> Result<Option<Settings>, sqlx::Error> {
        let settings = query_as!(
            Settings,
            r#"
            select locale, timezone from user_settings
            where user_id = $1
            limit 1;
            "#,
            user_id,
        )
        .fetch_optional(&self.pg_pool)
        .await?;

        Ok(settings)
    }
}

#[derive(Debug, ToSchema, Serialize)]
pub struct Settings {
    pub locale: Option<String>,
    pub timezone: Option<String>,
}
