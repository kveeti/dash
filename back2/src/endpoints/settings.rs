use axum::{Json, extract::State, response::IntoResponse};
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{auth_middleware::User, data::Settings, error::ApiError, state::AppState};

#[derive(Deserialize, ToSchema)]
pub struct SaveSettingsInput {
    pub locale: String,
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
            },
        )
        .await?;

    Ok(())
}

#[utoipa::path(
    get,
    path = "/settings",
    operation_id = "settings/get",
    responses(
        (status = 200, body = Settings)
    )
)]
pub async fn get(State(state): State<AppState>, user: User) -> Result<impl IntoResponse, ApiError> {
    let settings = state
        .data
        .get_settings(&user.id)
        .await?
        .unwrap_or_else(|| Settings {
            locale: "en-US".to_string(),
        });

    Ok(Json(settings))
}
