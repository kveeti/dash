use axum::{Json, extract::State, response::IntoResponse};
use serde::Serialize;

use crate::{
    auth_middleware::LoggedInUser, config::EnvironmentVariables, error::ApiError, state::AppState,
};

#[cfg_attr(feature = "docs", utoipa::path(
    get,
    path = "/v1/integrations",
    operation_id = "v1/integrations/get",
    responses(
        (status = 200, body = GetIntegrationsOutput),
    )
))]
#[tracing::instrument(skip(state))]
pub async fn get(
    State(state): State<AppState>,
    user: LoggedInUser,
) -> Result<impl IntoResponse, ApiError> {
    let connected = state.data.get_user_bank_integrations(&user.id).await?;

    let available = state
        .config
        .allowed_integrations
        .iter()
        .filter(|i| !connected.iter().any(|c| c.name == *i.name))
        .map(|i| Integration {
            label: i.label.to_string(),
            name: i.name.to_string(),
            link: i.link_path.to_string(),
        })
        .collect();

    let connected = connected
        .iter()
        .map(|i| {
            let ai = &state
                .config
                .allowed_integrations
                .iter()
                .find(|ai| i.name == ai.name)
                .unwrap();

            ConnectedIntegration {
                label: ai.label.to_string(),
                name: ai.name.to_string(),
            }
        })
        .collect();

    Ok(Json(GetIntegrationsOutput {
        connected,
        available,
    }))
}

pub fn allowed_integrations(envs: &EnvironmentVariables) -> Vec<AllowedIntegration> {
    let mut allowed_integrations = vec![AllowedIntegration {
        label: "OP".to_string(),
        name: "gocardless-nordigen::OP_OKOYFIHH".to_string(),
        link_path: "/v1/integrations/gocardless-nordigen/connect-init/OP_OKOYFIHH".to_string(),
        days_back: 729,
    }];

    if envs.gcn_allow_sandbox {
        allowed_integrations.push(AllowedIntegration {
            label: "sandbox".to_string(),
            name: "gocardless-nordigen::SANDBOXFINANCE_SFIN0000".to_string(),
            link_path: "/v1/integrations/gocardless-nordigen/connect-init/SANDBOXFINANCE_SFIN0000"
                .to_string(),
            days_back: 90,
        });
    }

    return allowed_integrations;
}

#[derive(Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct GetIntegrationsOutput {
    connected: Vec<ConnectedIntegration>,
    available: Vec<Integration>,
}
#[derive(Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct AllowedIntegration {
    pub label: String,
    pub name: String,
    pub link_path: String,
    pub days_back: u32,
}

#[derive(Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct Integration {
    pub label: String,
    pub name: String,
    pub link: String,
}

#[derive(Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct ConnectedIntegration {
    pub label: String,
    pub name: String,
}
