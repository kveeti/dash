use anyhow::Context;
use config::{Config as ConfigLoader, Environment};
use dotenv::dotenv;
use serde::Deserialize;
use tracing::warn;

#[derive(Deserialize, Debug)]
struct EnvironmentVariables {
    database_url: String,
    port: Option<u16>,
    cors_origin: Option<String>,
}

pub struct Config {
    pub database_url: String,
    pub port: u16,
    pub cors_origin: Option<String>,
}

impl Config {
    pub fn new() -> Result<Self, anyhow::Error> {
        let _ = dotenv().map_err(|err| warn!("error loading .env: {:?}", err));

        let settings = ConfigLoader::builder()
            .add_source(Environment::default().try_parsing(true))
            .build()
            .context("failed to build configuration")?;

        let envs: EnvironmentVariables = settings
            .try_deserialize()
            .context("invalid environment variables")?;

        Ok(Config {
            database_url: envs.database_url,
            port: envs.port.unwrap_or(8001),
            cors_origin: envs.cors_origin,
        })
    }
}
