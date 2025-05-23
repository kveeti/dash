use anyhow::Context;
use chrono::{DateTime, Utc};
use sqlx::{Postgres, QueryBuilder, query};
use tokio::io::AsyncRead;

use super::{Data, create_id};

impl Data {
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
              and lower(ti.category_name) = lower(tc.name)
              and ti.user_id = $1;
            "#,
            user_id,
            import_id
        )
        .execute(&mut *tx)
        .await
        .context("error updating category_ids")?;

        // TODO: figure out the lower calls
        sqlx::query(
            r#"
            with cats as (
                select distinct on (lower(ti.category_name))
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
                lower(cats.category_name),
                false
            from cats
            where cats.category_id is not null
              and cats.category_name is not null
            on conflict (user_id, lower(name))
            do update set
                updated_at = $2,
                name = excluded.name,
                is_neutral = false
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
                currency, counter_party, og_counter_party,
                additional, category_id, created_at
            )
            select
                id, user_id, account_id, date, amount,
                currency, counter_party, og_counter_party,
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

    pub async fn import_tx<T: AsyncRead + Unpin>(
        &self,
        user_id: &str,
        source: T,
    ) -> Result<(), anyhow::Error> {
        let mut conn = self
            .pg_pool
            .acquire()
            .await
            .context("error acquiring connection")?;

        let mut copy_in = conn
            .copy_in_raw(
                r#"
                COPY transaction_imports (
                    id,
                    user_id,
                    created_at,

                    date,
                    amount,
                    currency,
                    counter_party,
                    og_counter_party,
                    additional,
                    account_id,
                    category_name,
                    category_id
                ) FROM STDIN WITH (FORMAT CSV)
                "#,
            )
            .await?;

        copy_in
            .read_from(source)
            .await
            .context("error reading from source")?;

        copy_in.finish().await.context("error finishing copy")?;

        conn.close().await.context("error closing connection")?;

        let mut tx = self
            .pg_pool
            .begin()
            .await
            .context("error starting transaction")?;

        // TODO: figure out the lower calls
        sqlx::query(
            r#"
            with cats as (
                select distinct on (lower(ti.category_name))
                    ti.category_id,
                    ti.category_name
                from transaction_imports ti
                where ti.user_id = $1
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
                lower(cats.category_name),
                false
            from cats
            where cats.category_id is not null
              and cats.category_name is not null
            on conflict (user_id, lower(name))
            do update set
                updated_at = $2,
                name = excluded.name,
                is_neutral = false
            returning transaction_categories.id;
            "#,
        )
        .bind(user_id)
        .bind(Utc::now())
        .bind(None::<DateTime<Utc>>)
        .execute(&mut *tx)
        .await
        .context("error inserting categories")?;

        sqlx::query!(
            r#"
            update transaction_imports ti
            set category_id = tc.id
            from transaction_categories tc
            where ti.user_id = tc.user_id
              and ti.category_name is not null
              and lower(ti.category_name) = lower(tc.name)
              and ti.user_id = $1;
            "#,
            user_id
        )
        .execute(&mut *tx)
        .await
        .context("error updating category_ids")?;

        sqlx::query!(
            r#"
            insert into transactions (
                id, user_id, account_id, date, amount,
                currency, counter_party, og_counter_party,
                additional, category_id, created_at
            )
            select
                id, user_id, account_id, date, amount,
                currency, counter_party, og_counter_party,
                additional, category_id, created_at
            from transaction_imports
            where user_id = $1
            on conflict (id) do nothing
            "#,
            user_id
        )
        .execute(&mut *tx)
        .await
        .context("error inserting transactions")?;

        tx.commit().await.context("error committing transaction")?;

        Ok(())
    }

    pub async fn insert_many_transactions(
        &self,
        user_id: &str,
        account_id: &str,
        transactions: Vec<InsertTx>,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let updated_at: Option<DateTime<Utc>> = None;

        let mut builder: QueryBuilder<Postgres> = QueryBuilder::new(
            r#"
                insert into transactions (
                    user_id,
                    id,
                    created_at,
                    updated_at,
                    date,
                    amount,
                    currency,
                    counter_party,
                    og_counter_party,
                    additional,
                    account_id
                )
            "#,
        );

        builder.push_values(transactions, |mut b, tx| {
            b.push_bind(user_id);
            b.push_bind(tx.id);
            b.push_bind(now);
            b.push_bind(updated_at);
            b.push_bind(tx.date);
            b.push_bind(tx.amount);
            b.push_bind(tx.currency);
            b.push_bind(tx.counter_party);
            b.push_bind(tx.og_counter_party);
            b.push_bind(tx.additional);
            b.push_bind(account_id);
        });

        let query = builder.build();
        query.execute(&self.pg_pool).await?;

        Ok(())
    }

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
               id, user_id, created_at, updated_at, date, amount, currency, 
               counter_party, og_counter_party, additional, account_id, category_id
           )
           select 
               $1, $2::text, $3, $3, $4, $5, $6, $7, $7, $8,
               (select id from accounts where id = $9 and user_id = $2::text),
               (select id from transaction_categories where id = $10::text and user_id = $2::text)
           "#,
            tx_id,            // $1
            user_id,          // $2
            now,              // $3
            tx.date,          // $4
            tx.amount,        // $5
            tx.currency,      // $6
            tx.counter_party, // $7
            tx.additional,    // $8
            account_id,       // $9
            category_id,      // $10
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

    pub async fn update_tx_2<'a>(
        &self,
        user_id: &str,
        tx_id: &str,
        input: &UpdateTx<'a>,
        account: String,
        category: Option<String>,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();

        let new_account_id = create_id();
        let new_category_id = create_id();

        query!(
            r#"
            with
            account_check as (
                select 
                    id,
                    case when id = $1 then true else false end as is_id
                from accounts 
                where (id = $1 or name = $1) and user_id = $2
            ),
            account_upsert as (
                insert into accounts (
                    id,
                    user_id,
                    created_at,
                    updated_at,
                    external_id,
                    name
                )
                select 
                    $11, $2, $3, $3, null, $1::text
                where 
                    not exists (select 1 from account_check where is_id = true) and
                    not exists (select 1 from accounts where name = $1 and user_id = $2)
                on conflict (user_id, name)
                do update set 
                    updated_at = excluded.updated_at
                returning id
            ),
            category_check as (
                select 
                    id,
                    case when id = $4 then true else false end as is_id
                from transaction_categories
                where (id = $4 or lower(name) = lower($4)) and user_id = $2
                union all
                select null::text, false where $4 is null
            ),
            category_upsert as (
                insert into transaction_categories (
                    id,
                    user_id,
                    created_at,
                    updated_at,
                    is_neutral,
                    name
                )
                select 
                    $12, $2, $3, $3, false, $4::text
                where 
                    $4 is not null and
                    not exists (select 1 from category_check where is_id = true) and
                    not exists (select 1 from transaction_categories where lower(name) = lower($4) and user_id = $2)
                on conflict (user_id, lower(name))
                do update set 
                    updated_at = excluded.updated_at
                returning id
            )
            update transactions
            set
                updated_at = $3,
                date = $5,
                amount = $6,
                currency = $7,
                counter_party = $8,
                additional = $9,
                category_id = coalesce(
                    (select id from category_check where is_id = true),
                    (select id from category_check where is_id = false and id is not null),
                    (select id from category_upsert)
                ),
                account_id = coalesce(
                    (select id from account_check where is_id = true),
                    (select id from account_check where is_id = false and id is not null),
                    (select id from account_upsert)
                )
            where id = $10 and user_id = $2
            "#,
            account,                         // $1
            user_id,                         // $2
            now,                             // $3
            category as Option<String>,      // $4
            input.date,                      // $5
            input.amount,                    // $6
            input.currency,                  // $7
            input.counter_party,             // $8
            input.additional,                // $9
            tx_id,                           // $10
            new_account_id,                  // $11
            new_category_id,                 // $12
        )
        .execute(&self.pg_pool)
        .await?;

        Ok(())
    }

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

    pub async fn tx_bulk_actions(
        &self,
        user_id: &str,
        tx_ids: Vec<String>,
        category_id: &str,
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

#[derive(Debug)]
pub struct UpdateTx<'a> {
    pub date: DateTime<Utc>,
    pub counter_party: &'a str,
    pub additional: Option<&'a str>,
    pub currency: &'a str,
    pub amount: f32,
}

#[derive(Debug)]
pub struct InsertTx {
    pub id: String,
    pub date: DateTime<Utc>,
    pub counter_party: String,
    pub og_counter_party: String,
    pub additional: Option<String>,
    pub currency: String,
    pub amount: f32,
}
