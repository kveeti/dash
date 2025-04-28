use axum::{
    extract::{self, Path, State},
    response::IntoResponse,
};
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{auth_middleware::User, error::ApiError, services, state::AppState};

#[derive(Deserialize, ToSchema)]
pub struct Input {
    pub id: String,
}

#[utoipa::path(
    post,
    path = "/transactions/{id}/linked",
    params(
        ("id" = String, description = "Transaction ID"),
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
pub async fn link(
    State(state): State<AppState>,
    user: User,
    Path(id): Path<String>,
    extract::Json(input): extract::Json<Input>,
) -> Result<impl IntoResponse, ApiError> {
    services::transactions::link(&state.data, &user.id, &id, &input.id).await?;

    Ok(())
}

#[utoipa::path(
    delete,
    path = "/transactions/{id}/linked/{linked_id}",
    params(
        ("id" = String, description = "Transaction ID"),
        ("linked_id" = String, description = "Linked transaction ID"),
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
pub async fn unlink(
    State(state): State<AppState>,
    user: User,
    Path(id): Path<String>,
    Path(linked_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    services::transactions::unlink(&state.data, &user.id, &id, &linked_id).await?;

    Ok(())
}
