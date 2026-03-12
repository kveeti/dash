use anyhow::Context;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{query, query_as};

use super::create_id;

use crate::endpoints::integrations::{
    enable_banking::SavedDataEnableBanking, gocardless_nordigen::SavedDataGoCardlessNordigen,
};

use super::Data;

impl Data {
    #[tracing::instrument(skip(self))]
    pub async fn get_user_bank_integrations(
        &self,
        user_id: &str,
    ) -> Result<Vec<UserBankIntergration>, sqlx::Error> {
        let rows = query_as!(
            UserBankIntergration,
            "select name, data, created_at from user_bank_integrations where user_id = $1 and deleted_at is null",
            user_id
        )
        .fetch_all(&self.pg_pool)
        .await?;

        Ok(rows)
    }

    #[tracing::instrument(skip(self))]
    pub async fn get_one_user_bank_integration(
        &self,
        user_id: &str,
        name: &str,
    ) -> Result<Option<UserBankIntergration>, sqlx::Error> {
        let row = query_as!(
            UserBankIntergration,
            "select name, data, created_at from user_bank_integrations where user_id = $1 and name = $2 and deleted_at is null",
            user_id,
            name
        )
        .fetch_optional(&self.pg_pool)
        .await?;

        Ok(row)
    }

    #[tracing::instrument(skip(self))]
    pub async fn set_user_bank_integration(
        &self,
        user_id: &str,
        name: &str,
        data: Value,
    ) -> Result<(), sqlx::Error> {
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
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn set_user_bank_integration_with_accounts(
        &self,
        user_id: &str,
        name: &str,
        data: Value,
        accounts: Vec<InsertManyAccount>,
    ) -> Result<(), anyhow::Error> {
        let mut tx = self
            .pg_pool
            .begin()
            .await
            .context("error starting transaction")?;

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
        .execute(&mut *tx)
        .await
        .context("error upserting user_bank_integrations")?;

        for account in accounts {
            let new_id = create_id();
            query!(
                r#"
                insert into accounts (id, user_id, created_at, external_id, name)
                values (
                    coalesce(
                        (select id from accounts where user_id = $1 and external_id = $2),
                        $3
                    ),
                    $1, $4, $2, $5
                )
                on conflict (id) do update set
                    external_id = excluded.external_id,
                    name = excluded.name
                "#,
                user_id,
                account.external_id,
                new_id,
                now,
                account.name,
            )
            .execute(&mut *tx)
            .await
            .context("error upserting account")?;
        }

        tx.commit().await.context("error committing transaction")?;

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn delete_user_bank_integration(
        &self,
        user_id: &str,
        name: &str,
    ) -> Result<(), sqlx::Error> {
        query!(
            r#"
            update user_bank_integrations
            set deleted_at = now()
            where user_id = $1 and name = $2 and deleted_at is null
            "#,
            user_id,
            name
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SavedDataEnvelope {
    GocardlessNordigen {
        #[serde(flatten)]
        data: SavedDataGoCardlessNordigen,
    },
    EnableBanking {
        #[serde(flatten)]
        data: SavedDataEnableBanking,
    },
}

pub struct UserBankIntergration {
    pub name: String,
    pub data: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug)]
pub struct InsertManyAccount {
    pub external_id: String,
    pub name: String,
}
