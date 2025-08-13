use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{query, query_as};

use super::Data;

impl Data {
    #[tracing::instrument(skip(self))]
    pub async fn save_settings(
        &self,
        user_id: &str,
        settings: UserSettings,
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

    #[tracing::instrument(skip(self))]
    pub async fn get_settings(&self, user_id: &str) -> Result<Option<UserSettings>, sqlx::Error> {
        let row = query_as!(
            UserSettings,
            r#"
            select locale, timezone from user_settings
            where user_id = $1
            limit 1;
            "#,
            user_id,
        )
        .fetch_optional(&self.pg_pool)
        .await?;

        Ok(row)
    }
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct UserSettings {
    pub locale: Option<String>,
    pub timezone: Option<String>,
}
