use anyhow::Context;
use axum::{
    extract::{Query, State},
    response::IntoResponse,
};
use serde_json::json;

use crate::{error::ApiError, state::AppState};

#[derive(Deserialize)]
pub struct Input {
    pub bank_id: String,
}

pub async fn gocardless_nordigen_test(
    State(state): State<AppState>,
    Query(input): Query<Input>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = "1";
    let integ = GoCardlessNordigen::new(&state.config)
        .await
        .context("error initializing integration")?;
    let bank_id = input.bank_id;

    let integ_name = format!("gcn_{bank_id}");

    let data = state
        .data
        .user_bank_integrations
        .get(&user_id, &integ_name)
        .await
        .context("error getting integration data")?;

    let req = match data {
        Some(data) => serde_json::from_value::<SavedReq>(data.data).expect("from value"),
        None => {
            let available_banks = integ
                .get_available_banks("fi")
                .await
                .context("error getting available banks")?;

            let bank = available_banks
                .iter()
                .find(|x| x.id == bank_id)
                .expect("bank");

            let req = integ
                .init_user(&user_id, bank)
                .await
                .context("error initializing user")?;

            let to_save = SavedReq {
                id: req.id,
                link: req.link,
            };

            state
                .data
                .user_bank_integrations
                .set(
                    &user_id,
                    &integ_name,
                    serde_json::to_value(&to_save).expect("to saved req"),
                )
                .await
                .context("error setting data")?;

            to_save
        }
    };

    let accounts = integ
        .get_accounts(&req.id)
        .await
        .context("error getting accounts")?;

    if let Some(acc) = accounts.get(0) {
        let transactions = integ
            .get_transactions(acc)
            .await
            .context("error getting transactions")?;
    } else {
        println!("no accounts yet");
    }

    Ok(())
}

use reqwest::{Client, ClientBuilder};
use serde::{Deserialize, Serialize};

use crate::config::Config;

pub struct GoCardlessNordigen {
    access_token: String,
    refresh_token: String,
    client: Client,
}

const BASE_URL: &str = "https://bankaccountdata.gocardless.com/api/v2";

impl GoCardlessNordigen {
    pub async fn new(config: &Config) -> Result<Self, anyhow::Error> {
        let client = ClientBuilder::new()
            .build()
            .context("error creating client")?;

        let token_res = client
            .post(format!("{BASE_URL}/token/new/"))
            .json(&json!({
                "secret_id": config.gcn_secret_id,
                "secret_key": config.gcn_secret_key
            }))
            .send()
            .await
            .context("error making token req")?
            .json::<TokenRes>()
            .await
            .context("error parsing token req")?;

        Ok(Self {
            access_token: token_res.access,
            refresh_token: token_res.refresh,
            client,
        })
    }

    pub async fn get_available_banks(
        &self,
        country: &str,
    ) -> Result<Vec<AvailableBank>, anyhow::Error> {
        let banks = self
            .client
            .get(format!("{BASE_URL}/institutions?country={country}"))
            .bearer_auth(&self.access_token)
            .send()
            .await
            .context("error making banks req")?
            .json::<Vec<AvailableBank>>()
            .await
            .context("error parsing banks res")?;

        Ok(banks)
    }

    pub async fn init_user(
        &self,
        user_id: &str,
        bank: &AvailableBank,
    ) -> Result<Requisition, anyhow::Error> {
        let end_user_agreement = self
            .client
            .post(format!("{BASE_URL}/agreements/enduser/"))
            .bearer_auth(&self.access_token)
            .json(&json!({
                "institution_id": bank.id,
                "max_historical_days": "3",
                "access_valid_for_days": "1",
                "access_scope": vec!["transactions"],
            }))
            .send()
            .await
            .context("error making eua req")?
            .json::<EndUserAgreement>()
            .await
            .context("error parsing eua res")?;

        let requisition = self
            .client
            .post(format!("{BASE_URL}/requisitions/",))
            .bearer_auth(&self.access_token)
            .json(&json!({
                "institution_id": bank.id,
                "redirect": "http://localhost:8000/api/integration-callback/gcn",
                "reference": user_id,
                "agreement": end_user_agreement.id,
                "user_language": "EN"
            }))
            .send()
            .await
            .context("error making requisition req")?
            .json::<Requisition>()
            .await
            .context("error parsing requisition res")?;

        Ok(requisition)
    }

    pub async fn get_accounts(&self, req_id: &str) -> Result<Vec<String>, anyhow::Error> {
        let requisition = self
            .client
            .get(format!("{BASE_URL}/requisitions/{req_id}"))
            .bearer_auth(&self.access_token)
            .send()
            .await
            .context("error making requisition req")?
            .json::<Requisition>()
            .await
            .context("error parsing requisition res")?;

        Ok(requisition.accounts)
    }

    pub async fn get_transactions(
        &self,
        account_id: &str,
    ) -> Result<Vec<Transaction>, anyhow::Error> {
        let res = self
            .client
            .get(format!("{BASE_URL}/accounts/{account_id}/transactions"))
            .bearer_auth(&self.access_token)
            .send()
            .await
            .context("error making transactions req")?
            .json::<TransactionRes>()
            .await
            .context("error parsing transactions res")?;

        Ok(res.transactions.booked)
    }
}

#[derive(Deserialize)]
struct TokenRes {
    pub access: String,
    pub refresh: String,
}

#[derive(Deserialize)]
pub struct AvailableBank {
    pub id: String,
    pub name: String,
    pub transaction_total_days: String,
    pub max_access_valid_for_days: String,
}

#[derive(Deserialize)]
pub struct EndUserAgreement {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct Requisitions {
    pub results: Vec<Requisition>,
}

#[derive(Debug, Deserialize)]
pub struct Requisition {
    pub id: String,
    pub link: String,
    pub accounts: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SavedReq {
    pub id: String,
    pub link: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TransactionRes {
    pub transactions: TransactionsResTransactions,
}
#[derive(Debug, Deserialize, Serialize)]
pub struct TransactionsResTransactions {
    pub booked: Vec<Transaction>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all(deserialize = "camelCase", serialize = "camelCase"))]
pub struct Transaction {
    pub transaction_id: String,
    pub creditor_name: Option<String>,
    pub debtor_name: Option<String>,
    pub transaction_amount: TransactionAmount,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TransactionAmount {
    pub currency: String,
    pub amount: String,
}
