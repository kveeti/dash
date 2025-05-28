use axum::{Json, extract::State, response::IntoResponse};
use once_cell::sync::Lazy;
use serde::Serialize;
use utoipa::ToSchema;

use crate::{auth_middleware::User, error::ApiError, state::AppState};

pub struct AvailableIntegration {
    pub label: String,
    pub name: String,
    pub link_path: String,
}
static AVAILABLE_INTEGRATIONS: Lazy<[AvailableIntegration; 2]> = Lazy::new(|| {
    [
        AvailableIntegration {
            label: "OP".to_string(),
            name: "gocardless-nordigen::OP_OKOYFIHH".to_string(),
            link_path: "/api/integrations/gocardless-nordigen/connect-init/OP_OKOYFIHH".to_string(),
        },
        AvailableIntegration {
            label: "sandbox".to_string(),
            name: "gocardless-nordigen::SANDBOXFINANCE_SFIN0000".to_string(),
            link_path: "/api/integrations/gocardless-nordigen/connect-init/SANDBOXFINANCE_SFIN0000"
                .to_string(),
        },
    ]
});

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

    let available: Vec<Integration> = AVAILABLE_INTEGRATIONS
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
            &AVAILABLE_INTEGRATIONS
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
