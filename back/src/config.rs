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
    base_url: String,
    session_ttl_days: Option<i64>,
}

pub struct Config {
    pub database_url: String,
    pub port: u16,
    pub cors_origin: Option<String>,
    pub base_url: String,
    pub session_ttl_days: i64,
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

        const DEFAULT_SESSION_TTL_DAYS: i64 = 7;
        const MIN_SESSION_TTL_DAYS: i64 = 1;
        const MAX_SESSION_TTL_DAYS: i64 = 30;
        let raw_session_ttl_days = envs.session_ttl_days.unwrap_or(DEFAULT_SESSION_TTL_DAYS);
        let session_ttl_days =
            raw_session_ttl_days.clamp(MIN_SESSION_TTL_DAYS, MAX_SESSION_TTL_DAYS);
        if raw_session_ttl_days != session_ttl_days {
            warn!(
                "SESSION_TTL_DAYS {} out of range [{}..={}], clamped to {}",
                raw_session_ttl_days, MIN_SESSION_TTL_DAYS, MAX_SESSION_TTL_DAYS, session_ttl_days
            );
        }

        Ok(Config {
            database_url: envs.database_url,
            port: envs.port.unwrap_or(8000),
            cors_origin: envs.cors_origin,
            base_url: envs.base_url,
            session_ttl_days,
        })
    }
}
