use axum::{Json, response::IntoResponse};
use serde::Serialize;
use utoipa::ToSchema;

use crate::{auth_middleware::User, error::ApiError};

#[derive(Serialize, ToSchema)]
pub struct Me {
    pub id: String,
}

#[utoipa::path(
    get,
    path = "/@me",
    responses(
        (status = 200, body = Me)
    )
)]
pub async fn get_me(user: User) -> Result<impl IntoResponse, ApiError> {
    return Ok(Json(Me {
        id: user.id.to_owned(),
    }));
}
