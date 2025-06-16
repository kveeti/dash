use anyhow::Context;
use axum::{
    extract::{Path, State},
    response::IntoResponse,
};

use crate::{auth_middleware::LoggedInUser, error::ApiError, state::AppState};

use super::gocardless_nordigen::{GoCardlessNordigen, SavedDataGoCardlessNordigen};

#[utoipa::path(
    delete,
    path = "/v1/integrations/{integration_name}",
    operation_id = "v1/integrations/delete",
    params(
        ("integration_name" = String, description = "integration name"),
    ),
)]
pub async fn delete(
    State(state): State<AppState>,
    user: LoggedInUser,
    Path(integration_name): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let integration = state
        .config
        .allowed_integrations
        .iter()
        .find(|ai| ai.name == integration_name)
        .ok_or(ApiError::BadRequest("invalid integration".to_string()))?;

    let (integration_name, _) = integration.name.split_once("::").context("shouldnt fail")?;

    match integration_name {
        "gocardless-nordigen" => {
            let saved_data = state
                .data
                .get_one_user_bank_integration(&user.id, &integration.name)
                .await?
                .and_then(|d| {
                    serde_json::from_value::<SavedDataGoCardlessNordigen>(d.data)
                        .context("error parsing saved data")
                        .ok()
                })
                .ok_or(ApiError::BadRequest("no saved data".to_owned()))?;

            let integ = GoCardlessNordigen::new(&state.config)
                .await
                .context("error initializing gcn")?;

            integ.delete_requisition(&saved_data.requisition_id).await?;

            state
                .data
                .delete_user_bank_integration(&user.id, &integration.name)
                .await?;
        }
        _ => {}
    }

    Ok(())
}
