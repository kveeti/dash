use axum::{
    extract::{self, State},
    response::IntoResponse,
};
use http::StatusCode;
use serde::Deserialize;
use serde_with::{NoneAsEmptyString, serde_as};
use utoipa::ToSchema;

use crate::{auth_middleware::User, error::ApiError, state::AppState};

#[serde_as]
#[derive(Deserialize, ToSchema)]
pub struct TransactionBulkInput {
    pub ids: Vec<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    pub category_id: Option<String>,
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
        .tx_bulk_actions(&user.id, input.ids, input.category_id.as_deref())
        .await?;

    return Ok(StatusCode::OK);
}
