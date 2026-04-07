use std::convert::Infallible;
use axum::{Json, extract::{Query, State}, response::sse::{Event, Sse}};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tokio_stream::StreamExt as _;
use tokio_stream::wrappers::BroadcastStream;

use crate::error::ApiError;
use crate::middleware::AuthUser;
use crate::state::SyncNotifier;

#[derive(Serialize)]
pub struct HandshakeResponse {
    pub server_time_ms: i64,
}

pub async fn handshake(_user: AuthUser) -> Json<HandshakeResponse> {
    Json(HandshakeResponse {
        server_time_ms: chrono::Utc::now().timestamp_millis(),
    })
}

// --- SSE events ---

pub async fn events(
    user: AuthUser,
    State(notifier): State<SyncNotifier>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    tracing::info!("SSE client connected: user={}", user.user_id);
    let rx = notifier.subscribe(user.user_id);
    let stream = BroadcastStream::new(rx)
        .filter_map(|result| {
            // Skip lagged messages
            match result {
                Ok(()) => Some(Ok(Event::default().event("sync").data(""))),
                Err(_) => None,
            }
        });

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(std::time::Duration::from_secs(30))
    )
}

// --- Pull ---

#[derive(Deserialize)]
pub struct PullQuery {
    pub since_version: i64,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    1000
}

#[derive(Serialize, sqlx::FromRow)]
pub struct PullItem {
    pub item_id: String,
    pub schema_version: i32,
    pub hlc: String,
    pub server_version: i64,
    pub encrypted_blob: String,
    pub is_deleted: bool,
}

#[derive(Serialize)]
pub struct PullResponse {
    pub items: Vec<PullItem>,
    pub has_more: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub force_reset: bool,
}

pub async fn pull(
    user: AuthUser,
    State(pool): State<PgPool>,
    Query(query): Query<PullQuery>,
) -> Result<Json<PullResponse>, ApiError> {
    let limit = query.limit.min(1000).max(1);

    // Check if client needs a full reset (data was compacted away)
    if query.since_version > 0 {
        let min_version: Option<(i64,)> = sqlx::query_as(
            "SELECT MIN(server_version) FROM sync_items WHERE user_id = $1"
        )
        .bind(user.user_id)
        .fetch_optional(&pool)
        .await?;

        if let Some((min_ver,)) = min_version {
            if query.since_version < min_ver {
                return Ok(Json(PullResponse {
                    items: vec![],
                    has_more: false,
                    force_reset: true,
                }));
            }
        }
    }

    let rows: Vec<PullItem> = sqlx::query_as(
        "SELECT item_id, schema_version, hlc, server_version, encrypted_blob, is_deleted \
         FROM sync_items \
         WHERE user_id = $1 AND server_version > $2 \
         ORDER BY server_version ASC \
         LIMIT $3"
    )
    .bind(user.user_id)
    .bind(query.since_version)
    .bind(limit + 1)
    .fetch_all(&pool)
    .await?;

    let has_more = rows.len() as i64 > limit;
    let items: Vec<PullItem> = rows.into_iter().take(limit as usize).collect();

    Ok(Json(PullResponse {
        items,
        has_more,
        force_reset: false,
    }))
}

// --- Push ---

#[derive(Deserialize)]
pub struct PushRequest {
    pub items: Vec<PushItem>,
}

#[derive(Deserialize)]
pub struct PushItem {
    pub item_id: String,
    pub schema_version: i32,
    pub hlc: String,
    pub encrypted_blob: String,
    pub is_deleted: bool,
}

#[derive(Serialize)]
pub struct RejectedItem {
    pub item_id: String,
    pub current_hlc: String,
}

#[derive(Serialize)]
pub struct PushResponse {
    pub accepted: Vec<String>,
    pub rejected: Vec<RejectedItem>,
    pub max_server_version: i64,
}

pub async fn push(
    user: AuthUser,
    State(pool): State<PgPool>,
    State(notifier): State<SyncNotifier>,
    Json(req): Json<PushRequest>,
) -> Result<Json<PushResponse>, ApiError> {
    let mut accepted = Vec::new();
    let mut rejected = Vec::new();

    let mut tx = pool.begin().await?;

    for item in req.items {
        // Attempt upsert only if incoming HLC wins.
        // For new rows (no conflict), always insert.
        // For existing rows, only update if incoming hlc > stored hlc.
        let result = sqlx::query(
            "INSERT INTO sync_items (user_id, item_id, schema_version, hlc, encrypted_blob, is_deleted, tombstoned_at) \
             VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 THEN NOW() ELSE NULL END) \
             ON CONFLICT (user_id, item_id) DO UPDATE SET \
               schema_version = EXCLUDED.schema_version, \
               hlc = EXCLUDED.hlc, \
               server_version = nextval('sync_items_server_version_seq'), \
               encrypted_blob = EXCLUDED.encrypted_blob, \
               is_deleted = EXCLUDED.is_deleted, \
               tombstoned_at = CASE WHEN EXCLUDED.is_deleted THEN NOW() ELSE NULL END \
             WHERE sync_items.hlc < EXCLUDED.hlc"
        )
        .bind(user.user_id)
        .bind(&item.item_id)
        .bind(item.schema_version)
        .bind(&item.hlc)
        .bind(&item.encrypted_blob)
        .bind(item.is_deleted)
        .execute(&mut *tx)
        .await?;

        if result.rows_affected() > 0 {
            accepted.push(item.item_id);
        } else {
            // Row existed with hlc >= incoming — fetch current hlc for rejection
            let current: Option<(String,)> = sqlx::query_as(
                "SELECT hlc FROM sync_items WHERE user_id = $1 AND item_id = $2"
            )
            .bind(user.user_id)
            .bind(&item.item_id)
            .fetch_optional(&mut *tx)
            .await?;

            rejected.push(RejectedItem {
                item_id: item.item_id,
                current_hlc: current.map(|r| r.0).unwrap_or_default(),
            });
        }
    }

    // Get the current max server_version for this user so the client can advance its cursor
    let max_version: i64 = sqlx::query_as::<_, (i64,)>(
        "SELECT COALESCE(MAX(server_version), 0) FROM sync_items WHERE user_id = $1"
    )
    .bind(user.user_id)
    .fetch_one(&mut *tx)
    .await?
    .0;

    tx.commit().await?;

    // Notify other connected clients that new data is available
    if !accepted.is_empty() {
        tracing::info!("notifying SSE clients: user={}, accepted={}", user.user_id, accepted.len());
        notifier.notify(user.user_id);
    }

    Ok(Json(PushResponse { accepted, rejected, max_server_version: max_version }))
}
