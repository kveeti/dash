use anyhow::Context;
use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

use crate::{auth_middleware::User, data::Account, error::ApiError, state::AppState};

#[derive(Deserialize, ToSchema, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct Input {
    pub search_text: Option<String>,
}

#[utoipa::path(
    get,
    path = "/accounts",
    operation_id = "accounts/query",
    params(
        Input
    ),
    responses(
        (status = 200, body = Vec<Account>),
    )
)]
pub async fn query(
    State(state): State<AppState>,
    user: User,
    Query(input): Query<Input>,
) -> Result<impl IntoResponse, ApiError> {
    let accounts = state
        .data
        .query_accounts(&user.id, &input.search_text)
        .await
        .context("error querying accounts")?;

    Ok(Json(accounts))
}
