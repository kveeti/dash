use sqlx::{PgPool, Row};
use ulid::Ulid;

use crate::proto::{DeltaOp, PushOp};

#[derive(Clone)]
pub struct Db {
    pool: PgPool,
}

pub struct PushResult {
    pub applied: Vec<DeltaOp>,
    pub not_applied_ids: Vec<String>,
}

pub struct BootstrapPage {
    pub entries: Vec<DeltaOp>,
    pub next_cursor: Option<i64>,
    pub server_max_version: i64,
}

impl Db {
    pub fn from_pool(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn upsert_user_with_auth_public_key(
        &self,
        external_id: &str,
        auth_public_key: &str,
    ) -> Result<String, sqlx::Error> {
        let new_id = Ulid::new().to_string();
        let row: (String,) = sqlx::query_as(
            r#"
            insert into users (id, external_id, auth_public_key)
            values ($1, $2, $3)
            on conflict (external_id) do update set
                external_id = excluded.external_id
            returning id
            "#,
        )
        .bind(&new_id)
        .bind(external_id)
        .bind(auth_public_key)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    pub async fn get_user_by_external_id(
        &self,
        external_id: &str,
    ) -> Result<Option<(String, String)>, sqlx::Error> {
        let row: Option<(String, String)> =
            sqlx::query_as(
                "select id, auth_public_key from users where external_id = $1 limit 1",
            )
                .bind(external_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row)
    }

    pub async fn get_user_auth_public_key(
        &self,
        user_id: &str,
    ) -> Result<Option<String>, sqlx::Error> {
        let row: Option<(String,)> =
            sqlx::query_as("select auth_public_key from users where id = $1")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|(auth_public_key,)| auth_public_key))
    }

    pub async fn create_session(
        &self,
        user_id: &str,
        ttl_days: i64,
    ) -> Result<String, sqlx::Error> {
        let session_id = Ulid::new().to_string();
        sqlx::query(
            r#"
            insert into sessions (id, user_id, expires_at)
            values ($1, $2, now() + make_interval(days => $3::int))
            "#,
        )
        .bind(&session_id)
        .bind(user_id)
        .bind(ttl_days)
        .execute(&self.pool)
        .await?;
        Ok(session_id)
    }

    pub async fn touch_session(
        &self,
        user_id: &str,
        session_id: &str,
        ttl_days: i64,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            r#"
            update sessions
            set expires_at = now() + make_interval(days => $3::int),
                updated_at = now()
            where user_id = $1
              and id = $2
              and expires_at > now()
            "#,
        )
        .bind(user_id)
        .bind(session_id)
        .bind(ttl_days)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn delete_session(&self, user_id: &str, session_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("delete from sessions where user_id = $1 and id = $2")
            .bind(user_id)
            .bind(session_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn resolve_session_user_id(
        &self,
        session_id: &str,
    ) -> Result<Option<String>, sqlx::Error> {
        let row: Option<(String,)> = sqlx::query_as(
            r#"
            select user_id
            from sessions
            where id = $1
              and expires_at > now()
            limit 1
            "#,
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|(user_id,)| user_id))
    }

    pub async fn load_bootstrap_page(
        &self,
        user_id: &str,
        cursor: i64,
        limit: i64,
    ) -> Result<BootstrapPage, sqlx::Error> {
        let server_max_version: i64 = sqlx::query_scalar(
            "select coalesce((select _sync_server_version from users where id = $1), 0)",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;

        let rows = sqlx::query(
            r#"
            select id, blob, _sync_is_deleted, _sync_edited_at, _sync_server_version
            from entries
            where user_id = $1 and _sync_server_version > $2
            order by _sync_server_version asc
            limit $3
            "#,
        )
        .bind(user_id)
        .bind(cursor)
        .bind(limit + 1)
        .fetch_all(&self.pool)
        .await?;

        let has_more = rows.len() as i64 > limit;
        let take = if has_more { limit as usize } else { rows.len() };

        let mut entries: Vec<DeltaOp> = Vec::with_capacity(take);
        for row in rows.iter().take(take) {
            let blob: Vec<u8> = row.try_get("blob")?;
            entries.push(DeltaOp {
                id: row.try_get("id")?,
                blob,
                is_deleted: row.try_get("_sync_is_deleted")?,
                edited_at: row.try_get("_sync_edited_at")?,
                server_version: row.try_get("_sync_server_version")?,
            });
        }

        let next_cursor = if has_more {
            entries.last().map(|e| e.server_version)
        } else {
            None
        };

        Ok(BootstrapPage {
            entries,
            next_cursor,
            server_max_version,
        })
    }

    pub async fn apply_push_ops(
        &self,
        user_id: &str,
        ops: &[PushOp],
    ) -> Result<PushResult, anyhow::Error> {
        if ops.is_empty() {
            return Ok(PushResult {
                applied: Vec::new(),
                not_applied_ids: Vec::new(),
            });
        }

        let mut tx = self.pool.begin().await?;
        let mut applied: Vec<DeltaOp> = Vec::with_capacity(ops.len());
        let mut not_applied_ids: Vec<String> = Vec::new();
        let mut current_server_version: i64 =
            sqlx::query_scalar("select _sync_server_version from users where id = $1 for update")
                .bind(user_id)
                .fetch_one(&mut *tx)
                .await?;

        for op in ops {
            let next_server_version = current_server_version + 1;
            let row = sqlx::query(
                r#"
                insert into entries (
                    user_id, id, blob, _sync_is_deleted, _sync_edited_at,
                    _sync_server_version, _sync_server_updated_at
                )
                values ($1, $2, $3, $4, $5, $6, now())
                on conflict (user_id, id) do update set
                    blob = excluded.blob,
                    _sync_is_deleted = excluded._sync_is_deleted,
                    _sync_edited_at = excluded._sync_edited_at,
                    _sync_server_version = $6,
                    _sync_server_updated_at = now()
                where excluded._sync_edited_at >= entries._sync_edited_at
                returning _sync_server_version, _sync_is_deleted, _sync_edited_at
                "#,
            )
            .bind(user_id)
            .bind(&op.id)
            .bind(&op.blob)
            .bind(op.is_deleted)
            .bind(op.edited_at)
            .bind(next_server_version)
            .fetch_optional(&mut *tx)
            .await?;

            if let Some(row) = row {
                let server_version: i64 = row.try_get("_sync_server_version")?;
                let is_deleted: bool = row.try_get("_sync_is_deleted")?;
                let edited_at: i64 = row.try_get("_sync_edited_at")?;
                applied.push(DeltaOp {
                    id: op.id.clone(),
                    blob: op.blob.clone(),
                    is_deleted,
                    edited_at,
                    server_version,
                });
                current_server_version = server_version;
            } else {
                not_applied_ids.push(op.id.clone());
            }
        }

        sqlx::query("update users set _sync_server_version = $2 where id = $1")
            .bind(user_id)
            .bind(current_server_version)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        applied.sort_by_key(|op| op.server_version);
        Ok(PushResult {
            applied,
            not_applied_ids,
        })
    }
}
