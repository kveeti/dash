use axum::{Json, extract::State, response::IntoResponse};
use serde::Serialize;
use utoipa::ToSchema;

use crate::{auth_middleware::User, error::ApiError, state::AppState};

#[utoipa::path(
    get,
    path = "/integrations",
    operation_id = "integrations/get",
    responses(
        (status = 200, body = GetIntegrationsOutput),
    )
)]
pub async fn get(State(state): State<AppState>, user: User) -> Result<impl IntoResponse, ApiError> {
    let connected = state.data.get_user_bank_integrations(&user.id).await?;

    let available: Vec<Integration> = state
        .config
        .allowed_integrations
        .iter()
        .filter(|i| !connected.iter().any(|c| c.name == *i.name))
        .map(|i| Integration {
            name: i.label.to_string(),
            link: format!(
                "{base}{path}",
                base = state.config.back_base_url,
                path = i.link_path
            ),
        })
        .collect();

    let connected = connected
        .iter()
        .map(|i| {
            &state
                .config
                .allowed_integrations
                .iter()
                .find(|ai| i.name == ai.name)
                .unwrap()
                .label
        })
        .cloned()
        .collect();

    Ok(Json(GetIntegrationsOutput {
        connected,
        available,
    }))
}

#[derive(Serialize, ToSchema)]
pub struct GetIntegrationsOutput {
    connected: Vec<String>,
    available: Vec<Integration>,
}

#[derive(Serialize, ToSchema)]
pub struct Integration {
    pub name: String,
    pub link: String,
}

pub struct AllowedIntegration {
    pub label: String,
    pub name: String,
    pub link_path: String,
}
