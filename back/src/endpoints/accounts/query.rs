use anyhow::Context;
use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use serde::Deserialize;

use crate::{auth_middleware::LoggedInUser, error::ApiError, state::AppState};

#[cfg(feature = "docs")]
use crate::data::Account;

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "docs", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "docs", into_params(parameter_in = Query))]
pub struct Input {
    pub search_text: Option<String>,
}

#[cfg_attr(feature = "docs", utoipa::path(
    get,
    path = "/v1/accounts",
    operation_id = "v1/accounts/query",
    params(
        Input
    ),
    responses(
        (status = 200, body = Vec<Account>),
    )
))]
#[tracing::instrument(skip(state))]
pub async fn query(
    State(state): State<AppState>,
    user: LoggedInUser,
    Query(input): Query<Input>,
) -> Result<impl IntoResponse, ApiError> {
    let accounts = state
        .data
        .query_accounts(&user.id, &input.search_text)
        .await
        .context("error querying accounts")?;

    Ok(Json(accounts))
}
