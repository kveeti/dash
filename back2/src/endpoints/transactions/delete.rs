use axum::{
    extract::{Path, State},
    response::IntoResponse,
};
use http::StatusCode;

use crate::{auth_middleware::User, error::ApiError, state::AppState};

#[utoipa::path(
    delete,
    path = "/transactions/{id}",
    params(
        ("id" = String, description = "Transaction ID"),
    ),
    responses(
        (status = 204, body = ())
    )
)]
pub async fn delete(
    State(state): State<AppState>,
    user: User,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    state.data.delete_tx(&user.id, &id).await?;

    return Ok(StatusCode::NO_CONTENT);
}
