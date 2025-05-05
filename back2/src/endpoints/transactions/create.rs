use axum::{
    extract::{self, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use http::StatusCode;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{auth_middleware::User, error::ApiError, services, state::AppState};

#[derive(Deserialize, ToSchema)]
pub struct CreateTransactionInput {
    pub counter_party: String,
    pub date: DateTime<Utc>,
    pub amount: f32,
    pub additional: Option<String>,
    pub category_name: Option<String>,
    pub account_name: String,
}

#[utoipa::path(
    post,
    path = "/transactions",
    request_body(
        content = CreateTransactionInput,
        content_type = "application/json",
    ),
    responses(
        (status = 201, body = ())
    )
)]
pub async fn create(
    State(state): State<AppState>,
    user: User,
    extract::Json(input): extract::Json<CreateTransactionInput>,
) -> Result<impl IntoResponse, ApiError> {
    services::transactions::create(&state.data, &user.id, &input).await?;

    return Ok(StatusCode::CREATED);
}
