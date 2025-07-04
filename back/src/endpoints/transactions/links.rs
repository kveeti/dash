use axum::{
    extract::{self, Path, State},
    response::IntoResponse,
};
use http::StatusCode;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{auth_middleware::LoggedInUser, error::ApiError, state::AppState};

#[derive(Debug, Deserialize, ToSchema)]
pub struct Input {
    pub id: String,
}

#[utoipa::path(
    post,
    path = "/v1/transactions/{id}/linked",
    operation_id = "v1/transactions/id/linked",
    params(
        ("id" = String, description = "transaction id"),
    ),
    request_body(
        content = Input,
        content_type = "application/json",
    ),
    responses(
        (status = 201, body = ()),
        (status = 400, description = "Bad request"),
    )
)]
#[tracing::instrument(skip(state))]
pub async fn link(
    State(state): State<AppState>,
    user: LoggedInUser,
    Path(id): Path<String>,
    extract::Json(input): extract::Json<Input>,
) -> Result<impl IntoResponse, ApiError> {
    if id == input.id {
        return Err(ApiError::BadRequest("Cannot link to self".into()));
    }

    state.data.link_tx(&user.id, &id, &input.id).await?;

    Ok(StatusCode::CREATED)
}

#[utoipa::path(
    delete,
    path = "/v1/transactions/{id}/linked/{linked_id}",
    params(
        ("id" = String, description = "Transaction ID"),
        ("linked_id" = String, description = "Linked transaction ID"),
    ),
    responses(
        (status = 204, body = ()),
        (status = 400, description = "Bad request"),
    )
)]
#[tracing::instrument(skip(state))]
pub async fn unlink(
    State(state): State<AppState>,
    user: LoggedInUser,
    Path((id, linked_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    if id == linked_id {
        return Err(ApiError::BadRequest("Cannot unlink self".into()));
    }

    state.data.unlink_tx(&user.id, &id, &linked_id).await?;

    Ok(StatusCode::NO_CONTENT)
}
