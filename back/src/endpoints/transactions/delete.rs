use axum::{
    extract::{Path, State},
    response::IntoResponse,
};
use http::StatusCode;

use crate::{auth_middleware::LoggedInUser, error::ApiError, state::AppState};

#[utoipa::path(
    delete,
    path = "/v1/transactions/{id}",
    operation_id = "v1/transactions/delete",
    params(
        ("id" = String, description = "Transaction ID"),
    ),
    responses(
        (status = 204, body = ())
    )
)]
#[tracing::instrument(skip(state))]
pub async fn delete(
    State(state): State<AppState>,
    user: LoggedInUser,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    state.data.delete_tx(&user.id, &id).await?;

    return Ok(StatusCode::NO_CONTENT);
}
