use axum::{Json, extract::State, response::IntoResponse};
use serde::Serialize;
use utoipa::ToSchema;

use crate::{auth_middleware::LoggedInUser, data::Settings, error::ApiError, state::AppState};

#[derive(Serialize, ToSchema)]
pub struct MeOutput {
    pub id: String,
    pub settings: Option<Settings>,
}

#[utoipa::path(
    get,
    path = "/@me",
    responses(
        (status = 200, body = MeOutput)
    )
)]
pub async fn get_me(
    State(state): State<AppState>,
    user: LoggedInUser,
) -> Result<impl IntoResponse, ApiError> {
    let settings = state.data.get_settings(&user.id).await?;

    return Ok(Json(MeOutput {
        id: user.id.to_owned(),
        settings,
    }));
}
