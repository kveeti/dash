use axum::{
    extract::{self, Path, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use http::StatusCode;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{auth_middleware::User, error::ApiError, services, state::AppState};

#[derive(Deserialize, ToSchema)]
pub struct Input {
    pub counter_party: String,
    pub date: DateTime<Utc>,
    pub amount: f32,
    pub additional: Option<String>,
    pub category_id: Option<String>,
}

#[utoipa::path(
    post,
    path = "/transactions/{id}",
    params(
        ("id" = String, description = "Transaction ID"),
    ),
    request_body(
        content = Input,
        content_type = "application/json",
    ),
    responses(
        (status = 204, body = ())
    )
)]
pub async fn update(
    State(state): State<AppState>,
    user: User,
    Path(id): Path<String>,
    extract::Json(input): extract::Json<Input>,
) -> Result<impl IntoResponse, ApiError> {
    services::transactions::update(&state.data, &user.id, &id, &input).await?;

    return Ok(StatusCode::NO_CONTENT);
}
