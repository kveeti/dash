use std::collections::HashMap;

use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::{IntoParams, ToSchema};

use crate::{auth_middleware::User, error::ApiError, services, state::AppState};

#[derive(IntoParams)]
pub struct Input {
    pub timezone: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}
#[derive(Serialize, ToSchema)]
pub struct Output {
    pub total_pos: f32,
    pub total_neg: f32,
    pub categories: Vec<String>,
    pub data: HashMap<String, HashMap<String, OutputDataValue>>,
    pub domain_start: f32,
    pub domain_end: f32,
}
#[derive(Serialize, ToSchema)]
pub enum OutputDataValue {
    Period(String),
    Value(f32),
}

#[utoipa::path(
    get,
    path = "/transactions/stats",
    params(
        Input
    ),
    responses(
        (status = 200, body = Output)
    )
)]
pub async fn get_stats(
    State(state): State<AppState>,
    user: User,
    input: Query<Input>,
) -> Result<impl IntoResponse, ApiError> {
    let result = services::transactions::stats(
        &state.data,
        &user.id,
        &input.timezone,
        &input.start,
        &input.end,
    )
    .await?;

    return Ok(Json(result));
}
