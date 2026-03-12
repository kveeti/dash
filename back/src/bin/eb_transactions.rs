use anyhow::{anyhow, Context};
use config::{Config as ConfigLoader, Environment};
use dotenv::dotenv;
use serde::Deserialize;

use backend::config::EnableBankingConfig;
use backend::endpoints::integrations::enable_banking;

#[derive(Deserialize)]
struct Env {
    eb: Option<EnableBankingConfig>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv().ok();

    let env: Env = ConfigLoader::builder()
        .add_source(Environment::default().separator("__"))
        .build()
        .context("error loading config")?
        .try_deserialize()
        .context("error deserializing config")?;

    let eb_config = env.eb.ok_or_else(|| anyhow!("EB config not set"))?;

    let account_uid = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow!("usage: eb-transactions <account_uid>"))?;

    let transactions =
        enable_banking::get_transactions_raw(&eb_config, &account_uid, None).await?;

    let json = serde_json::to_string_pretty(&transactions)?;
    println!("{json}");

    Ok(())
}
