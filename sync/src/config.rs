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
    oidc_url: Option<String>,
    oidc_client_id: Option<String>,
    oidc_client_secret: Option<String>,
    oidc_redirect_url: Option<String>,
}

pub struct Config {
    pub database_url: String,
    pub port: u16,
    pub cors_origin: Option<String>,
    pub base_url: String,
    pub oidc: Option<OidcConfig>,
}

pub struct OidcConfig {
    pub url: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_url: String,
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

        let oidc = match (
            envs.oidc_url,
            envs.oidc_client_id,
            envs.oidc_client_secret,
            envs.oidc_redirect_url,
        ) {
            (Some(url), Some(client_id), Some(client_secret), Some(redirect_url))
                if !url.is_empty() =>
            {
                Some(OidcConfig {
                    url,
                    client_id,
                    client_secret,
                    redirect_url,
                })
            }
            _ => None,
        };

        Ok(Config {
            database_url: envs.database_url,
            port: envs.port.unwrap_or(8000),
            cors_origin: envs.cors_origin,
            base_url: envs.base_url,
            oidc,
        })
    }
}
