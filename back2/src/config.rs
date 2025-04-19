use anyhow::Context;
use dotenv::dotenv;
use serde::Deserialize;

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
}

impl Config {
    pub fn new() -> Result<Self, anyhow::Error> {
        dotenv().expect("error loading environment variables from .env");

        let envs = envy::from_env::<Self>().context("invalid environment variables")?;

        return Ok(envs);
    }
}
