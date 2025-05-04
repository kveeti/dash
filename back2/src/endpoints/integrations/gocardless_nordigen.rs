use std::collections::HashMap;

use anyhow::Context;
use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Redirect},
};
use futures::future::try_join_all;
use serde_json::json;
use tracing::info;

use crate::{auth_middleware::User, error::ApiError, state::AppState};

#[derive(Serialize)]
pub struct ConnectBankInitRes {
    pub link: String,
}

pub async fn connect_init(
    State(state): State<AppState>,
    Path(institution_id): Path<String>,
    user: User,
) -> Result<impl IntoResponse, ApiError> {
    let data_name = format!("gocardless-nordigen::{institution_id}");

    let data = state
        .data
        .user_bank_integrations
        .get(&user.id, &data_name)
        .await
        .context("error getting user bank integration data")?;

    let integ = GoCardlessNordigen::new(&state.config)
        .await
        .context("error initializing integration")?;

    match data {
        Some(data) => {
            let saved = serde_json::from_value::<SavedDataGoCardlessNordigen>(data.data)
                .context("error parsing saved data")?;

            let res = integ
                .client
                .delete(format!("{BASE_URL}/requisitions/{}/", saved.id))
                .bearer_auth(&integ.access_token)
                .send()
                .await
                .context("error sending DELETE requisitions/{id}/ request")?;

            if !res.status().is_success() {
                let res = res
                    .text()
                    .await
                    .context("error getting DELETE requisitions/{id}/ response text")?;
                info!("error deleting requisition, continuing anyway... res: {res}");
            }

            state
                .data
                .user_bank_integrations
                .delete(&user.id, &data_name)
                .await
                .context("error deleting saved data")?;
        }
        None => {}
    }

    let req = integ
        .create_requisition(&state.config, &user.id, &institution_id)
        .await
        .context("error creating requisition")?;

    let to_save = SavedDataGoCardlessNordigen {
        id: req.id,
        link: req.link.to_owned(),
        account_map: vec![],
    };

    state
        .data
        .user_bank_integrations
        .set(
            &user.id,
            &data_name,
            serde_json::to_value(&to_save).expect("to saved req"),
        )
        .await
        .context("error setting data")?;

    Ok(Redirect::to(&req.link))
}

pub async fn connect_callback(
    State(state): State<AppState>,
    Path(institution_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    user: User,
) -> Result<(), ApiError> {
    if let Some(error) = params.get("error") {
        return Err(ApiError::BadRequest(format!(
            "error in gocardless-nordigen callback {error}",
        )));
    }

    let data_name = format!("gocardless-nordigen::{institution_id}");

    let saved = state
        .data
        .user_bank_integrations
        .get(&user.id, &data_name)
        .await
        .context("error getting user bank integration data")?;

    if let Some(data) = saved {
        let saved = serde_json::from_value::<SavedDataGoCardlessNordigen>(data.data)
            .context("error parsing saved data")?;

        let integ = GoCardlessNordigen::new(&state.config)
            .await
            .context("error initializing integration")?;

        let req = integ
            .get_requisition(&saved.id)
            .await
            .context("error getting requisition")?;

        let accounts_futures = req.accounts.iter().map(|account_id| async {
            integ
                .get_account(account_id)
                .await
                .context("error getting accounts")
        });
        let accounts = try_join_all(accounts_futures).await?;

        let account_map = accounts
            .iter()
            .map(|account| (account.id.to_owned(), account.iban.to_owned()))
            .collect::<Vec<_>>();

        let to_save = SavedDataGoCardlessNordigen {
            id: saved.id,
            link: saved.link,
            account_map,
        };

        state
            .data
            .user_bank_integrations
            .set_with_accounts(
                &user.id,
                &data_name,
                serde_json::to_value(&to_save).expect("to saved req"),
                accounts
                    .iter()
                    .map(|account| account.iban.clone())
                    .collect(),
            )
            .await
            .context("error setting data")?;
    } else {
        return Err(ApiError::BadRequest("no saved data".to_string()));
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

    pub async fn get_requisition(&self, req_id: &str) -> Result<Requisition, anyhow::Error> {
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

        Ok(requisition)
    }

    pub async fn create_requisition(
        &self,
        config: &Config,
        user_id: &str,
        institution_id: &str,
    ) -> Result<Requisition, anyhow::Error> {
        let eua = self
            .client
            .post(format!("{BASE_URL}/agreements/enduser/"))
            .bearer_auth(&self.access_token)
            .json(&json!({
                "institution_id": institution_id,
                "max_historical_days": 3,
                "access_valid_for_days": 1,
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
                "institution_id": institution_id,
                "redirect": format!("{api_base}/api/integrations/gocardless-nordigen/connect-callback/{institution_id}", api_base = config.back_base_url),
                "reference": user_id,
                "agreement": eua.id,
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
            .get(format!("{BASE_URL}/requisitions/{req_id}/"))
            .bearer_auth(&self.access_token)
            .send()
            .await
            .context("error making requisition req")?
            .json::<Requisition>()
            .await
            .context("error parsing requisition res")?;

        Ok(requisition.accounts)
    }

    pub async fn get_account(&self, account_id: &str) -> Result<Account, anyhow::Error> {
        let acc = self
            .client
            .get(format!("{BASE_URL}/accounts/{account_id}/"))
            .bearer_auth(&self.access_token)
            .send()
            .await
            .context("error making acc req")?
            .json::<Account>()
            .await
            .context("error parsing acc res")?;

        Ok(acc)
    }

    pub async fn get_transactions(
        &self,
        account_id: &str,
    ) -> Result<Vec<Transaction>, anyhow::Error> {
        let res = self
            .client
            .get(format!("{BASE_URL}/accounts/{account_id}/transactions/"))
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

#[derive(Debug, Deserialize)]
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

#[derive(Debug, Deserialize)]
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
    pub reference: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SavedDataGoCardlessNordigen {
    pub id: String,
    pub link: String,
    pub account_map: Vec<(String, String)>,
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
    pub value_date: String,
    pub remittance_information_unstructured: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TransactionAmount {
    pub currency: String,
    pub amount: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Account {
    pub id: String,
    pub iban: String,
    pub name: String,
    pub status: String,
}
