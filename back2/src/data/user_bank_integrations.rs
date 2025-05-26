use anyhow::Context;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{Postgres, QueryBuilder, query, query_as};

use super::{Account, Data, create_id};

impl Data {
    pub async fn get_user_bank_integrations(
        &self,
        user_id: &str,
    ) -> Result<Vec<UserBankIntergration>, sqlx::Error> {
        let rows = query_as!(
            UserBankIntergration,
            "select name, data from user_bank_integrations where user_id = $1",
            user_id
        )
        .fetch_all(&self.pg_pool)
        .await?;

        Ok(rows)
    }

    pub async fn get_one_user_bank_integration(
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
        .fetch_optional(&self.pg_pool)
        .await?;

        Ok(row)
    }

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

        if accounts.len() != 0 {
            let mut builder: QueryBuilder<Postgres> = QueryBuilder::new(
                r#"
                insert into accounts (
                    id,
                    user_id,
                    created_at,
                    external_id,
                    name
                )
                "#,
            );

            builder.push_values(accounts, |mut b, account| {
                b.push_bind(account.id);
                b.push_bind(user_id);
                b.push_bind(now);
                b.push_bind(account.external_id.to_owned());
                b.push_bind(account.external_id);
            });
        }

        tx.commit().await.context("error committing transaction")?;

        Ok(())
    }

    pub async fn delete_user_bank_integration(
        &self,
        user_id: &str,
        name: &str,
    ) -> Result<(), sqlx::Error> {
        query!(
            r#"
            delete from user_bank_integrations
            where user_id = $1 and name = $2
            "#,
            user_id,
            name
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }
}

pub struct UserBankIntergration {
    pub name: String,
    pub data: Value,
}

pub struct InsertManyAccount {
    pub id: String,
    pub external_id: String,
}
