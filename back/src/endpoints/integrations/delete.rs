use anyhow::Context;
use axum::{
    extract::{Path, State},
    response::IntoResponse,
};

use crate::{
    auth_middleware::LoggedInUser, data::SavedDataEnvelope, error::ApiError, state::AppState,
};

use super::enable_banking;

#[cfg_attr(feature = "docs", utoipa::path(
    delete,
    path = "/v1/integrations/{integration_name}",
    operation_id = "v1/integrations/delete",
    params(
        ("integration_name" = String, description = "integration name"),
    ),
))]
#[tracing::instrument(skip(state))]
pub async fn delete(
    State(state): State<AppState>,
    user: LoggedInUser,
    Path(integration_name): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let saved = state
        .data
        .get_one_user_bank_integration(&user.id, &integration_name)
        .await?
        .ok_or(ApiError::BadRequest("integration not found".to_owned()))?;

    // Soft-delete the row first
    state
        .data
        .delete_user_bank_integration(&user.id, &integration_name)
        .await?;

    // Best-effort external cleanup
    let envelope = serde_json::from_value::<SavedDataEnvelope>(saved.data)
        .context("error parsing saved data")?;

    if let (SavedDataEnvelope::EnableBanking { data }, Some(eb_config)) =
        (&envelope, &state.config.eb)
    {
        if let Err(e) = enable_banking::delete_session(eb_config, &data.session_id).await {
            tracing::warn!(?e, "failed to delete eb session");
        }
    }

    Ok(())
}
