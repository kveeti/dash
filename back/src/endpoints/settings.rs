use axum::{Json, extract::State, response::IntoResponse};
use serde::Deserialize;
use serde_with::{NoneAsEmptyString, serde_as};
use utoipa::ToSchema;

use crate::{auth_middleware::LoggedInUser, data::Settings, error::ApiError, state::AppState};

#[serde_as]
#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveSettingsInput {
    #[serde_as(as = "NoneAsEmptyString")]
    pub locale: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    pub timezone: Option<String>,
}

#[utoipa::path(
    post,
    path = "/v1/settings",
    operation_id = "v1/settings/save",
    request_body(
        content = SaveSettingsInput,
        content_type = "application/json",
    ),
    responses(
        (status = 200, body = ())
    )
)]
#[tracing::instrument(skip(state))]
pub async fn save(
    State(state): State<AppState>,
    user: LoggedInUser,
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
