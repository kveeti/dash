use anyhow::Context;
use dotenv::dotenv;
use serde::Deserialize;
use tracing::warn;

#[derive(Deserialize)]
pub struct Config {
    pub database_url: String,
    pub secret: String,
    pub front_base_url: String,
    pub back_base_url: String,
    pub auth_init_url: String,
    pub auth_token_url: String,
    pub auth_userinfo_url: String,
    pub auth_client_id: String,
    pub auth_client_secret: String,
    pub use_secure_cookies: bool,

    // gocardless nordigen
    pub gcn_secret_id: String,
    pub gcn_secret_key: String,
}

impl Config {
    pub fn new() -> Result<Self, anyhow::Error> {
        let _ = dotenv().map_err(|err| warn!("error loading .env: {:?}", err));

        let envs = envy::from_env::<Self>().context("invalid environment variables")?;

        return Ok(envs);
    }
}
