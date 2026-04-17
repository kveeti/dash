use axum::{
    Json, Router,
    extract::{Query, State},
    response::{IntoResponse, Response},
    routing::get,
};
use axum_extra::extract::CookieJar;
use base64::Engine;
use serde::Deserialize;
use sqlx::Row;

use crate::{
    auth::require_user_id,
    error::ApiError,
    proto::{BootstrapResponse, DeltaOp},
    state::AppState,
};

const DEFAULT_LIMIT: i64 = 1000;
const MAX_LIMIT: i64 = 1000;

#[derive(Deserialize)]
struct BootstrapQuery {
    cursor: Option<i64>,
    limit: Option<i64>,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/bootstrap", get(bootstrap))
}

async fn bootstrap(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(q): Query<BootstrapQuery>,
) -> Result<Response, ApiError> {
    let user_id = require_user_id(&state, &jar).await?;

    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let cursor = q.cursor.unwrap_or(0);

    let server_max_version: i64 = sqlx::query_scalar(
        "select coalesce(max(_sync_server_version), 0) from entries where user_id = $1",
    )
    .bind(&user_id)
    .fetch_one(&state.pool)
    .await?;

    // Fetch one extra row to determine if there's a next page.
    let rows = sqlx::query(
        r#"
        select id, _sync_hlc, blob, _sync_is_deleted, _sync_server_version
        from entries
        where user_id = $1 and _sync_server_version > $2
        order by _sync_server_version asc
        limit $3
        "#,
    )
    .bind(&user_id)
    .bind(cursor)
    .bind(limit + 1)
    .fetch_all(&state.pool)
    .await?;

    let has_more = rows.len() as i64 > limit;
    let take = if has_more { limit as usize } else { rows.len() };

    let mut entries: Vec<DeltaOp> = Vec::with_capacity(take);
    for row in rows.iter().take(take) {
        let blob: Vec<u8> = row.try_get("blob")?;
        entries.push(DeltaOp {
            id: row.try_get("id")?,
            hlc: row.try_get("_sync_hlc")?,
            blob: base64::engine::general_purpose::STANDARD.encode(&blob),
            is_deleted: row.try_get("_sync_is_deleted")?,
            server_version: row.try_get("_sync_server_version")?,
        });
    }

    let next_cursor = if has_more {
        entries.last().map(|e| e.server_version)
    } else {
        None
    };

    Ok(Json(BootstrapResponse {
        entries,
        next_cursor,
        server_max_version,
    })
    .into_response())
}
