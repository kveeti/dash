use anyhow::Context;
use config::{Config as ConfigLoader, Environment};
use dotenv::dotenv;
use serde::Deserialize;
use tracing::warn;

use crate::endpoints::integrations::get::{AllowedIntegration, allowed_integrations};

#[derive(Deserialize, Debug)]
pub struct EnvironmentVariables {
    pub database_url: String,
    pub secret: String,
    pub base_url: String,
    pub auth_url: String,
    pub auth_client_id: String,
    pub auth_client_secret: String,
    pub auth_user_id_whitelist: Option<Vec<String>>,
    pub auth_user_id_whitelist_enabled: bool,
    pub use_secure_cookies: bool,
    pub port: Option<u16>,

    // gocardless nordigen
    pub gcn_secret_id: String,
    pub gcn_secret_key: String,
    pub gcn_base_url: String,
    pub gcn_allow_sandbox: bool,

    // enable banking
    pub eb: Option<EnableBankingConfig>,

    pub frontend_dir: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct EnableBankingConfig {
    pub private_key: String,
    pub application_id: String,
}

pub struct Config {
    pub database_url: String,
    pub secret: String,
    pub base_url: String,
    pub auth_url: String,
    pub auth_client_id: String,
    pub auth_client_secret: String,
    pub auth_user_id_whitelist: Vec<String>,
    pub auth_user_id_whitelist_enabled: bool,
    pub use_secure_cookies: bool,
    pub port: u16,

    // gocardless nordigen
    pub gcn_secret_id: String,
    pub gcn_secret_key: String,
    pub gcn_base_url: String,

    pub eb: Option<EnableBankingConfig>,

    pub frontend_dir: Option<String>,

    pub allowed_integrations: Vec<AllowedIntegration>,
}

impl Config {
    pub fn new() -> Result<Self, anyhow::Error> {
        let _ = dotenv().map_err(|err| warn!("error loading .env: {:?}", err));

        let settings = ConfigLoader::builder()
            .add_source(Environment::default().try_parsing(true).separator("__"))
            .build()
            .context("failed to build configuration")?;

        let envs: EnvironmentVariables = settings
            .try_deserialize()
            .context("invalid environment variables")?;

        let allowed_integrations = allowed_integrations(&envs);

        Ok(Config {
            database_url: envs.database_url,
            secret: envs.secret,
            base_url: envs.base_url,
            auth_url: envs.auth_url,
            auth_client_id: envs.auth_client_id,
            auth_client_secret: envs.auth_client_secret,
            auth_user_id_whitelist: vec![],
            auth_user_id_whitelist_enabled: envs.auth_user_id_whitelist_enabled,
            use_secure_cookies: envs.use_secure_cookies,
            port: envs.port.unwrap_or(8000),

            gcn_secret_id: envs.gcn_secret_id,
            gcn_secret_key: envs.gcn_secret_key,
            gcn_base_url: envs.gcn_base_url,

            eb: envs.eb,

            frontend_dir: envs.frontend_dir,

            allowed_integrations,
        })
    }
}
