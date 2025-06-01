use anyhow::Context;
use dotenv::dotenv;
use serde::Deserialize;
use tracing::warn;

use crate::endpoints::integrations::get::AllowedIntegration;

#[derive(Deserialize)]
pub struct EnvironmentVariables {
    pub database_url: String,
    pub secret: String,
    pub front_base_url: String,
    pub back_base_url: String,
    pub auth_url: String,
    pub auth_client_id: String,
    pub auth_client_secret: String,
    pub use_secure_cookies: bool,

    // gocardless nordigen
    pub gcn_secret_id: String,
    pub gcn_secret_key: String,
    pub gcn_base_url: String,
    pub gcn_allow_sandbox: bool,
}

pub struct Config {
    pub database_url: String,
    pub secret: String,
    pub front_base_url: String,
    pub back_base_url: String,
    pub auth_url: String,
    pub auth_client_id: String,
    pub auth_client_secret: String,
    pub use_secure_cookies: bool,

    // gocardless nordigen
    pub gcn_secret_id: String,
    pub gcn_secret_key: String,
    pub gcn_base_url: String,

    pub allowed_integrations: Vec<AllowedIntegration>,
}

impl Config {
    pub fn new() -> Result<Self, anyhow::Error> {
        let _ = dotenv().map_err(|err| warn!("error loading .env: {:?}", err));

        let envs =
            envy::from_env::<EnvironmentVariables>().context("invalid environment variables")?;

        let allowed_integrations = allowed_integrations(&envs);

        return Ok(Config {
            database_url: envs.database_url,
            secret: envs.secret,
            front_base_url: envs.front_base_url,
            back_base_url: envs.back_base_url,
            auth_url: envs.auth_url,
            auth_client_id: envs.auth_client_id,
            auth_client_secret: envs.auth_client_secret,
            use_secure_cookies: envs.use_secure_cookies,

            gcn_secret_id: envs.gcn_secret_id,
            gcn_secret_key: envs.gcn_secret_key,
            gcn_base_url: envs.gcn_base_url,

            allowed_integrations,
        });
    }
}

fn allowed_integrations(envs: &EnvironmentVariables) -> Vec<AllowedIntegration> {
    let mut allowed_integrations = vec![AllowedIntegration {
        label: "OP".to_string(),
        name: "gocardless-nordigen::OP_OKOYFIHH".to_string(),
        link_path: "/api/integrations/gocardless-nordigen/connect-init/OP_OKOYFIHH".to_string(),
    }];

    if envs.gcn_allow_sandbox {
        allowed_integrations.push(AllowedIntegration {
            label: "sandbox".to_string(),
            name: "gocardless-nordigen::SANDBOXFINANCE_SFIN0000".to_string(),
            link_path: "/api/integrations/gocardless-nordigen/connect-init/SANDBOXFINANCE_SFIN0000"
                .to_string(),
        });
    }

    return allowed_integrations;
}
