use anyhow::Context;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{Postgres, QueryBuilder, query};
use tracing::info;

use crate::state::AppState;

use super::{Data, create_id};

impl Data {
    #[tracing::instrument(skip(self))]
    pub async fn get_pending_imports(&self) -> Result<Vec<(String, String)>, sqlx::Error> {
        let rows = sqlx::query_as::<_, (String, String)>(
            "select distinct user_id, import_id from transaction_imports",
        )
        .fetch_all(&self.pg_pool)
        .await?;

        return Ok(rows);
    }

    #[tracing::instrument(skip(self))]
    pub async fn import_tx_phase_2_v3(
        &self,
        user_id: &str,
        import_id: &str,
    ) -> Result<(), anyhow::Error> {
        let batch_size = 50_000i64;

        loop {
            let mut tx = self.pg_pool.begin().await?;

            let processed = sqlx::query!(
                r#"
            with batch as (
                select id, category_name, category_id
                from transaction_imports
                where user_id = $1 and import_id = $2
                order by id
                limit $3
            ),
            resolved as (
                select b.id, b.category_name, coalesce(b.category_id, tc.id) as resolved_category_id
                from batch b
                left join transaction_categories tc
                    on tc.user_id = $1 and tc.name = b.category_name
            ),
            inserted_categories as (
                insert into transaction_categories (id, user_id, created_at, name, is_neutral)
                select distinct
                    b.category_id, $1, $4::timestamptz, b.category_name, false
                from batch b
                where b.category_id is not null
                    and trim(b.category_id) != ''
                on conflict (user_id, name) do nothing
            ),
            moved as (
                delete from transaction_imports
                using resolved r
                where transaction_imports.id = r.id
                returning transaction_imports.id,
                          transaction_imports.user_id,
                          transaction_imports.account_id,
                          transaction_imports.date,
                          transaction_imports.amount,
                          transaction_imports.currency,
                          transaction_imports.counter_party,
                          transaction_imports.additional,
                          r.resolved_category_id as category_id,
                          transaction_imports.created_at
            )
            insert into transactions (
                id, user_id, account_id, date, amount,
                currency, counter_party,
                additional, category_id, created_at
            )
            select id, user_id, account_id, date, amount,
                   currency, counter_party,
                   additional, nullif(category_id, ''), created_at
            from moved
            on conflict (id) do nothing
            returning id
            "#,
                user_id,
                import_id,
                batch_size,
                Utc::now()
            )
            .fetch_all(&mut *tx)
            .await?
            .len();

            tx.commit().await?;

            if processed == 0 {
                break;
            }
        }

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn import_tx_phase_2_v2(
        &self,
        user_id: &str,
        import_id: &str,
    ) -> Result<(), anyhow::Error> {
        let batch_size = 50000i64;

        loop {
            let mut tx = self.pg_pool.begin().await?;

            sqlx::query!(
                r#"
                with batch as (
                    select id from transaction_imports 
                    where user_id = $1 and import_id = $2 
                    order by id
                    limit $3
                )
                update transaction_imports ti
                set category_id = tc.id
                from transaction_categories tc, batch b
                where ti.id = b.id
                  and ti.user_id = tc.user_id
                  and ti.category_name = tc.name
                "#,
                user_id,
                import_id,
                batch_size
            )
            .execute(&mut *tx)
            .await?;

            sqlx::query!(
                r#"
                with batch as (
                    select id, category_id, category_name from transaction_imports 
                    where user_id = $1 and import_id = $2 
                      and category_id is not null
                      and category_name is not null
                    order by id
                    limit $3
                )
                insert into transaction_categories (id, user_id, created_at, name, is_neutral)
                select distinct category_id, $1, $4::timestamptz, category_name, false
                from batch
                on conflict (user_id, name) do nothing
                "#,
                user_id,
                import_id,
                batch_size,
                Utc::now()
            )
            .execute(&mut *tx)
            .await?;

            let processed = sqlx::query!(
                r#"
                with batch as (
                    select id from transaction_imports
                    where user_id = $1 and import_id = $2
                    order by id
                    limit $3
                ),
                moved as (
                    delete from transaction_imports 
                    where id in (select id from batch)
                    returning id, user_id, account_id, date, amount,
                             currency, counter_party,
                             additional, category_id, created_at
                )
                insert into transactions (
                    id, user_id, account_id, date, amount,
                    currency, counter_party,
                    additional, category_id, created_at
                )
                select id, user_id, account_id, date, amount,
                       currency, counter_party,
                       additional, category_id, created_at
                from moved
                on conflict (id) do nothing
                "#,
                user_id,
                import_id,
                batch_size
            )
            .execute(&mut *tx)
            .await?
            .rows_affected();

            tx.commit().await?;
            info!("here");

            if processed == 0 {
                break;
            }
        }

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn import_tx_phase_2(
        &self,
        user_id: &str,
        import_id: &str,
    ) -> Result<(), anyhow::Error> {
        let mut tx = self
            .pg_pool
            .begin()
            .await
            .context("error starting transaction")?;

        sqlx::query!(
            r#"
            update transaction_imports ti
            set category_id = tc.id
            from transaction_categories tc
            where ti.import_id = $2
              and ti.user_id = tc.user_id
              and ti.category_name is not null
              and ti.category_name = tc.name
              and ti.user_id = $1;
            "#,
            user_id,
            import_id
        )
        .execute(&mut *tx)
        .await
        .context("error updating category_ids")?;

        sqlx::query(
            r#"
            with cats as (
                select distinct on ti.category_name
                    ti.category_id,
                    ti.category_name
                from transaction_imports ti
                where ti.import_id = $4
                    and ti.user_id = $1
                    and ti.category_id is not null
                    and ti.category_name is not null
            )

            insert into transaction_categories (
                id, user_id, created_at, updated_at,
                name, is_neutral
            )
            select
                cats.category_id,
                $1,
                $2,
                $3,
                cats.category_name,
                false
            from cats
            where cats.category_id is not null
              and cats.category_name is not null
            on conflict (user_id, name)
            do nothing
            returning transaction_categories.id;
            "#,
        )
        .bind(user_id)
        .bind(Utc::now())
        .bind(None::<DateTime<Utc>>)
        .bind(import_id)
        .execute(&mut *tx)
        .await
        .context("error inserting categories")?;

        sqlx::query!(
            r#"
            insert into transactions (
                id, user_id, account_id, date, amount,
                currency, counter_party,
                additional, category_id, created_at
            )
            select
                id, user_id, account_id, date, amount,
                currency, counter_party,
                additional, category_id, created_at
            from transaction_imports
            where user_id = $1 and import_id = $2
            on conflict (id) do nothing
            "#,
            user_id,
            import_id
        )
        .execute(&mut *tx)
        .await
        .context("error inserting transactions")?;

        tx.commit().await.context("error committing transaction")?;

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn insert_many_transactions_and_user_bank_integration(
        &self,
        user_id: &str,
        account_id: &str,
        transactions: Vec<InsertTx>,
        integration_name: &str,
        integration_data: Value,
    ) -> Result<(), anyhow::Error> {
        let mut tx = self
            .pg_pool
            .begin()
            .await
            .context("error starting transaction")?;

        let now = Utc::now();

        let mut builder: QueryBuilder<Postgres> = QueryBuilder::new(
            r#"
                insert into transactions (
                    user_id,
                    id,
                    created_at,
                    date,
                    amount,
                    currency,
                    counter_party,
                    additional,
                    account_id
                )
            "#,
        );

        builder.push_values(transactions, |mut b, tx| {
            b.push_bind(user_id);
            b.push_bind(tx.id);
            b.push_bind(now);
            b.push_bind(tx.date);
            b.push_bind(tx.amount);
            b.push_bind(tx.currency);
            b.push_bind(tx.counter_party);
            b.push_bind(tx.additional);
            b.push_bind(account_id);
        });

        let query = builder.build();
        query.execute(&mut *tx).await?;

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
            now,
            integration_name,
            integration_data
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await.context("error committing transaction")?;

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn insert_tx(
        &self,
        user_id: &str,
        tx: &InsertTx,
        account_id: String,
        category_id: Option<String>,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let tx_id = create_id();

        query!(
            r#"
            insert into transactions (
                id,
                user_id,
                created_at,
                updated_at,
                date,
                categorize_on,
                amount,
                currency,
                counter_party,
                additional,
                notes,
                account_id,
                category_id
            )
            select 
                $1, $2::text, $3, $3, $4, $5, $6, $7, $8, $9, $10,
                (select id from accounts where id = $11 and user_id = $2::text),
                (select id from transaction_categories where id = $12::text and user_id = $2::text)
           "#,
            tx_id,            // $1
            user_id,          // $2
            now,              // $3
            tx.date,          // $4
            tx.categorize_on, // $5
            tx.amount,        // $6
            tx.currency,      // $7
            tx.counter_party, // $8
            tx.additional,    // $9
            tx.notes,         // $10
            account_id,       // $11
            category_id,      // $12
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn update_tx_2<'a>(
        &self,
        user_id: &str,
        tx_id: &str,
        input: &UpdateTx<'a>,
        account_id: String,
        category_id: Option<String>,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();

        query!(
            r#"
            update transactions
            set
                updated_at = $1,
                date = $2,
                categorize_on = $3,
                amount = $4,
                currency = $5,
                counter_party = $6,
                additional = $7,
                notes = $8,
                account_id = (select id from accounts where id = $9 and user_id = $10::text),
                category_id = (select id from transaction_categories where id = $11::text and user_id = $10::text)
            where id = $12 and user_id = $10::text
            "#,
            now,                    // $1
            input.date,             // $2
            input.categorize_on,    // $3
            input.amount,           // $4
            input.currency,         // $5
            input.counter_party,    // $6
            input.additional,       // $7
            input.notes,            // $8
            account_id,             // $9
            user_id,                // $10
            category_id,            // $11
            tx_id,                  // $12
       )
       .execute(&self.pg_pool)
       .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn delete_tx(&self, user_id: &str, tx_id: &str) -> Result<(), sqlx::Error> {
        query!(
            r#"
            delete from transactions
            where user_id = $1 and id = $2
            "#,
            user_id,
            tx_id
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn link_tx(
        &self,
        user_id: &str,
        tx_a_id: &str,
        tx_b_id: &str,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let updated_at: Option<DateTime<Utc>> = None;

        query!(
            r#"
            with existing as (
                select user_id from transactions_links
                where user_id = $1
                and (
                    (transaction_a_id = $2 and transaction_b_id = $3)
                    or (transaction_a_id = $3 and transaction_b_id = $2)
                )
            )
            insert into transactions_links (
                user_id,
                created_at,
                updated_at,
                transaction_a_id,
                transaction_b_id
            )
            select $1, $4, $5, $2, $3
            where not exists (select 1 from existing);
            "#,
            user_id,
            tx_a_id,
            tx_b_id,
            now,
            updated_at
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn unlink_tx(
        &self,
        user_id: &str,
        tx1_id: &str,
        tx2_id: &str,
    ) -> Result<(), sqlx::Error> {
        query!(
            r#"
            delete from transactions_links
            where user_id = $1
            and (
                (transaction_a_id = $2 and transaction_b_id = $3)
                or (transaction_a_id = $3 and transaction_b_id = $2)
            )
            "#,
            user_id,
            tx1_id,
            tx2_id,
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn tx_bulk_actions(
        &self,
        user_id: &str,
        tx_ids: Vec<String>,
        category_id: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        query!(
            r#"
            update transactions
            set
                updated_at = $3,
                category_id = $2
            where user_id = $1 and id = ANY($4)
            "#,
            user_id,
            category_id,
            Utc::now(),
            &tx_ids[..]
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }
}

#[tracing::instrument(skip_all)]
pub async fn do_pending_imports(state: &AppState) -> Result<(), anyhow::Error> {
    let pending_imports = state
        .data
        .get_pending_imports()
        .await
        .context("error getting pending imports")?;

    tracing::info!("found {} pending imports", pending_imports.len());

    for (user_id, import_id) in pending_imports {
        let state_clone = state.clone();
        let user_id_clone = user_id.clone();
        let import_id_clone = import_id.clone();

        tokio::spawn(async move {
            tracing::info!("starting importing {import_id_clone}");
            if let Err(e) = state_clone
                .data
                .import_tx_phase_2_v2(&user_id_clone, &import_id_clone)
                .await
            {
                tracing::error!("error importing {}: {}", import_id_clone, e);
            }
        });
    }

    Ok(())
}

#[derive(Debug)]
pub struct UpdateTx<'a> {
    pub date: DateTime<Utc>,
    pub categorize_on: Option<DateTime<Utc>>,
    pub counter_party: &'a str,
    pub additional: Option<&'a str>,
    pub currency: &'a str,
    pub amount: f32,
    pub notes: Option<&'a str>,
}

#[derive(Debug)]
pub struct InsertTx {
    pub id: String,
    pub date: DateTime<Utc>,
    pub categorize_on: Option<DateTime<Utc>>,
    pub counter_party: String,
    pub additional: Option<String>,
    pub currency: String,
    pub amount: f32,
    pub notes: Option<String>,
}
