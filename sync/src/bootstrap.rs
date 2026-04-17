use axum::{
    Json, Router,
    extract::{Query, State},
    response::{IntoResponse, Response},
    routing::get,
};
use axum_extra::extract::CookieJar;
use serde::Deserialize;

use crate::{auth::require_user_id, error::ApiError, proto::BootstrapResponse, state::AppState};

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
    let page = state
        .db
        .load_bootstrap_page(&user_id, cursor, limit)
        .await?;

    Ok(Json(BootstrapResponse {
        entries: page.entries,
        next_cursor: page.next_cursor,
        server_max_version: page.server_max_version,
    })
    .into_response())
}
