use axum::{
    extract::{self, State},
    response::IntoResponse,
};
use http::StatusCode;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{auth_middleware::User, error::ApiError, state::AppState};

#[derive(Deserialize, ToSchema)]
pub struct TransactionBulkInput {
    pub ids: Vec<String>,
    pub category_id: String,
}

#[utoipa::path(
    post,
    path = "/transactions/bulk",
    operation_id = "transactions/bulk",
    request_body(
        content = TransactionBulkInput,
        content_type = "application/json",
    ),
    responses(
        (status = 204, body = ())
    )
)]
pub async fn bulk(
    State(state): State<AppState>,
    user: User,
    extract::Json(input): extract::Json<TransactionBulkInput>,
) -> Result<impl IntoResponse, ApiError> {
    state
        .data
        .tx_bulk_actions(&user.id, input.ids, &input.category_id)
        .await?;

    return Ok(StatusCode::OK);
}
