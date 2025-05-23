use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::{auth_middleware::User, error::ApiError, services, state::AppState};

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct Input {
    pub timezone: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

#[derive(Debug, ToSchema, Serialize)]
pub struct Output {
    pub dates: Vec<String>,
    pub i_cats: Vec<Vec<String>>,
    pub i: Vec<Vec<f32>>,
    pub e_cats: Vec<Vec<String>>,
    pub e: Vec<Vec<f32>>,
    pub n_cats: Vec<Vec<String>>,
    pub n: Vec<Vec<f32>>,
    pub tti: Vec<f32>,
    pub tte: Vec<f32>,
    pub ttn: Vec<f32>,
    pub ti: f32,
    pub te: f32,
}

#[derive(Serialize, ToSchema)]
pub enum OutputDataValue {
    Period(String),
    Value(f32),
}

#[utoipa::path(
    get,
    path = "/transactions/stats",
    operation_id = "transactions/stats",
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
