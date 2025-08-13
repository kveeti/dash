use axum::{
    extract::{self, State},
    response::IntoResponse,
};
use http::StatusCode;
use serde::Deserialize;
use serde_with::{NoneAsEmptyString, serde_as};

use crate::{auth_middleware::LoggedInUser, error::ApiError, state::AppState};

#[serde_as]
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct TransactionBulkInput {
    pub ids: Vec<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    pub category_id: Option<String>,
}

#[cfg_attr(feature = "docs", utoipa::path(
    post,
    path = "/v1/transactions/bulk",
    operation_id = "v1/transactions/bulk",
    request_body(
        content = TransactionBulkInput,
        content_type = "application/json",
    ),
    responses(
        (status = 204, body = ())
    )
))]
#[tracing::instrument(skip(state))]
pub async fn bulk(
    State(state): State<AppState>,
    user: LoggedInUser,
    extract::Json(input): extract::Json<TransactionBulkInput>,
) -> Result<impl IntoResponse, ApiError> {
    state
        .data
        .tx_bulk_actions(&user.id, input.ids, input.category_id.as_deref())
        .await?;

    return Ok(StatusCode::OK);
}
