use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use serde::Deserialize;

use crate::{auth_middleware::LoggedInUser, error::ApiError, state::AppState};

#[cfg(feature = "docs")]
use crate::data::TxCategory;

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "docs", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "docs", into_params(parameter_in = Query))]
pub struct Input {
    pub search_text: Option<String>,
    pub include_counts: Option<bool>,
}

#[cfg_attr(feature = "docs", utoipa::path(
    get,
    path = "/v1/categories",
    operation_id = "v1/categories/query",
    params(
        Input
    ),
    responses(
        (status = 200, body = Vec<TxCategory>),
    )
))]
#[tracing::instrument(skip(state))]
pub async fn query(
    State(state): State<AppState>,
    user: LoggedInUser,
    Query(input): Query<Input>,
) -> Result<impl IntoResponse, ApiError> {
    if input.include_counts.unwrap_or(false) {
        let categories = state
            .data
            .query_categories_with_counts(&user.id, &input.search_text)
            .await?;
        Ok(Json(categories).into_response())
    } else {
        let categories = state
            .data
            .query_categories(&user.id, &input.search_text)
            .await?;
        Ok(Json(categories).into_response())
    }
}
