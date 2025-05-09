use anyhow::Context;
use axum::{Json, extract::State, response::IntoResponse};
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{auth_middleware::User, data::QueryTx, error::ApiError, state::AppState};

#[derive(Deserialize, ToSchema, Debug)]
pub struct Input {
    pub search_text: Option<String>,
}

#[utoipa::path(
    post,
    path = "/transactions/query",
    request_body(
        content = Input,
        content_type = "application/json",
    ),
    responses(
        (status = 200, body = Vec<QueryTx>),
    )
)]
pub async fn query(
    State(state): State<AppState>,
    user: User,
    Json(input): Json<Input>,
) -> Result<impl IntoResponse, ApiError> {
    let res = state
        .data
        .query_transactions(&user.id)
        .await
        .context("error querying transactions")?;

    Ok(Json(res))
}
