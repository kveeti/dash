use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

use crate::{auth_middleware::User, data::Category, error::ApiError, services, state::AppState};

#[derive(Deserialize, ToSchema, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct Input {
    pub search_text: Option<String>,
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
    user: User,
    Query(input): Query<Input>,
) -> Result<impl IntoResponse, ApiError> {
    let res = services::categories::query(&state.data, &user.id, &input.search_text).await?;

    Ok(Json(res))
}
