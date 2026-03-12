use std::collections::HashMap;

use axum::{Json, extract::State, response::IntoResponse};
use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::{
    auth_middleware::LoggedInUser, config::EnvironmentVariables, data::SavedDataEnvelope,
    error::ApiError, state::AppState,
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

    let connected: Vec<ConnectedIntegration> = connected
        .iter()
        .map(|i| {
            let data = serde_json::from_value::<SavedDataEnvelope>(i.data.to_owned())
                .expect("deserializing saved data");

            match data {
                SavedDataEnvelope::GocardlessNordigen { data } => ConnectedIntegration {
                    label: data.institution_id.to_owned(),
                    name: i.name.to_owned(),
                    accounts: data.account_map.iter().map(|a| a.iban.to_owned()).collect(),
                    connected_at: i.created_at,
                    duplicate_of: vec![],
                },
                SavedDataEnvelope::EnableBanking { data } => ConnectedIntegration {
                    label: format!("{} {}", data.aspsp.name, data.aspsp.country),
                    name: i.name.to_owned(),
                    accounts: data
                        .accounts
                        .iter()
                        .map(|a| a.account_id.iban.to_owned())
                        .collect(),
                    connected_at: i.created_at,
                    duplicate_of: vec![],
                },
            }
        })
        .collect();

    // Detect duplicate accounts across integrations
    let mut iban_to_names: HashMap<String, Vec<String>> = HashMap::new();
    for c in &connected {
        for iban in &c.accounts {
            iban_to_names
                .entry(iban.clone())
                .or_default()
                .push(c.name.clone());
        }
    }

    let connected: Vec<ConnectedIntegration> = connected
        .into_iter()
        .map(|mut c| {
            let mut duplicates: Vec<String> = c
                .accounts
                .iter()
                .flat_map(|iban| iban_to_names.get(iban).into_iter().flatten())
                .filter(|name| **name != c.name)
                .cloned()
                .collect();
            duplicates.sort();
            duplicates.dedup();
            c.duplicate_of = duplicates;
            c
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
    pub accounts: Vec<String>,
    pub connected_at: DateTime<Utc>,
    pub duplicate_of: Vec<String>,
}
