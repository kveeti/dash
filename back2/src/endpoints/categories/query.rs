use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

use crate::{auth_middleware::LoggedInUser, data::Category, error::ApiError, state::AppState};

#[derive(Deserialize, ToSchema, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct Input {
    pub search_text: Option<String>,
    pub include_counts: Option<bool>,
}

#[utoipa::path(
    get,
    path = "/categories",
    operation_id = "categories/query",
    params(
        Input
    ),
    responses(
        (status = 200, body = Vec<Category>),
    )
)]
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
