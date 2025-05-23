use axum::{Json, extract::State, response::IntoResponse};
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{auth_middleware::User, data::Settings, error::ApiError, state::AppState};

#[derive(Deserialize, ToSchema)]
pub struct SaveSettingsInput {
    pub locale: Option<String>,
    pub timezone: Option<String>,
}

#[utoipa::path(
    post,
    path = "/settings",
    operation_id = "settings/save",
    request_body(
        content = SaveSettingsInput,
        content_type = "application/json",
    ),
    responses(
        (status = 200, body = ())
    )
)]
pub async fn save(
    State(state): State<AppState>,
    user: User,
    Json(payload): Json<SaveSettingsInput>,
) -> Result<impl IntoResponse, ApiError> {
    state
        .data
        .save_settings(
            &user.id,
            Settings {
                locale: payload.locale,
                timezone: payload.timezone,
            },
        )
        .await?;

    Ok(())
}
