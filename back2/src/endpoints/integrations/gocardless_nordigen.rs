use std::collections::HashMap;

use anyhow::{Context, anyhow};
use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Redirect},
};
use futures::future::try_join_all;
use serde_json::json;

use crate::{auth_middleware::User, data::create_id, error::ApiError, state::AppState};

#[derive(Serialize)]
pub struct ConnectBankInitRes {
    pub link: String,
}

// GCN USAGE
// - institution_id = bank identifier eg. OP_OKOYFIHH
// - saved data:
//   - id: requisition id
//   - link: requisition link, redirects to gocardless' bank connection flow
//   - account_map, this can only contain data after the user
//     has gone through the bank connection flow and gotten redirected back
//     to `connect_callback`
//
// - user wants to connect a bank -> calls connect_init with institution_id
//   EITHER:
//   - if theres saved data implying user has gone through the connection flow
//     for this institution before: redirect user to that previous requisition id
//   - otherwise: create new requisition
//      - provide a callback url which redirects to `connect-callback`
//      - with the institution_id in path
//      - save req.id and req.link
//      - redirect user to req.link
//  TODO: maybe ask user what their intentions are if saved data for
//        chosen instituition is found
//  they can either be:
//  - modify current requisition, *No new EUA or requisition needed*
//    eg. connect/give perms to other accounts if instituition's ui
//    supports that
//  - modify the EUA params, *Needs new EUA and requisition*
//    eg.
//    - `max_historical_days`
//    - `access_valid_for_days`
//    - note: `access_scope` is always `transactions`. That's the min and max
//      syncing transactions requires

// - user is redirected to gocardless, goes through the bank connection flow
//   and is redirected back to `connect-callback`
// - `connect-callback` reads institution_id from url
// - retrieves req.id from saved data from `connect_init`
// - retrieves the requisiton from gcn with req.id. Requisition
//   should now contain accounts the user wanted to connect
// - save the accounts by gcn id -> iban to saved data->account_map
//
//  TODO: deletion sequence. Provide a way for users to delete the connection.
//        Also do this on account deletion

pub async fn connect_init(
    State(state): State<AppState>,
    Path(institution_id): Path<String>,
    user: User,
) -> Result<impl IntoResponse, ApiError> {
    let data_name = format!("gocardless-nordigen::{institution_id}");

    let data = state
        .data
        .get_one_user_bank_integration(&user.id, &data_name)
        .await
        .context("error getting user bank integration data")?;

    let integ = GoCardlessNordigen::new(&state.config)
        .await
        .context("error initializing integration")?;

    let link = match data {
        Some(data) => {
            let saved = serde_json::from_value::<SavedDataGoCardlessNordigen>(data.data)
                .context("error parsing saved data")?;

            saved.requisition_link
        }
        None => {
            let req = integ
                .create_requisition(&state.config, &user.id, &institution_id)
                .await
                .context("error creating requisition")?;

            let to_save = SavedDataGoCardlessNordigen {
                institution_id,
                requisition_id: req.id,
                requisition_link: req.link.to_owned(),
                account_map: vec![],
            };

            state
                .data
                .set_user_bank_integration(
                    &user.id,
                    &data_name,
                    serde_json::to_value(&to_save).expect("to saved req"),
                )
                .await
                .context("error setting data")?;

            req.link
        }
    };

    Ok(Redirect::to(&link))
}

pub async fn connect_callback(
    State(state): State<AppState>,
    Path(institution_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    user: User,
) -> Result<impl IntoResponse, ApiError> {
    if let Some(error) = params.get("error") {
        return Err(ApiError::BadRequest(format!(
            "error in gocardless-nordigen callback {error}",
        )));
    }

    let data_name = format!("gocardless-nordigen::{institution_id}");

    let saved = state
        .data
        .get_one_user_bank_integration(&user.id, &data_name)
        .await
        .context("error getting user bank integration data")?;

    if let Some(data) = saved {
        let saved = serde_json::from_value::<SavedDataGoCardlessNordigen>(data.data)
            .context("error parsing saved data")?;

        let integ = GoCardlessNordigen::new(&state.config)
            .await
            .context("error initializing integration")?;

        let req = integ
            .get_requisition(&saved.requisition_id)
            .await
            .context("error getting requisition")?;

        let accounts_futures = req.accounts.iter().map(|account_id| async {
            integ
                .get_account(account_id)
                .await
                .context("error getting accounts")
        });
        let accounts = try_join_all(accounts_futures).await?;

        let account_map: Vec<SavedAccount> = accounts
            .iter()
            .map(|account| SavedAccount {
                id: create_id(),
                iban: account.iban.to_owned(),
                gcn_id: account.id.to_owned(),
            })
            .collect();

        let insert_accounts = account_map
            .iter()
            .map(|account| crate::data::InsertManyAccount {
                id: account.id.to_owned(),
                external_id: account.iban.to_owned(),
            })
            .collect();

        let to_save = SavedDataGoCardlessNordigen {
            account_map,
            ..saved
        };

        state
            .data
            .set_user_bank_integration_with_accounts(
                &user.id,
                &data_name,
                serde_json::to_value(&to_save).expect("to saved req"),
                insert_accounts,
            )
            .await
            .context("error setting data")?;
    } else {
        return Err(ApiError::BadRequest("no saved data".to_string()));
    }

    Ok(Redirect::to(&state.config.front_base_url))
}

use reqwest::{Client, ClientBuilder};
use serde::{Deserialize, Serialize};

use crate::config::Config;

pub struct GoCardlessNordigen {
    access_token: String,
    refresh_token: String,
    client: Client,
    base_url: String,
}

impl GoCardlessNordigen {
    pub async fn new(config: &Config) -> Result<Self, anyhow::Error> {
        let client = ClientBuilder::new()
            .build()
            .context("error creating client")?;

        let base_url = config.gcn_base_url.clone();

        let url = format!("{base}/token/new/", base = base_url);
        println!("{url}");
        let token_res = client
            .post(url)
            .json(&json!({
                "secret_id": config.gcn_secret_id,
                "secret_key": config.gcn_secret_key
            }))
            .send()
            .await
            .context("error making token req")?;

        let status = token_res.status();
        if !status.is_success() {
            let text = token_res.text().await?;
            return Err(anyhow!(format!("token req error {text} {status}")));
        }

        let token_res = token_res
            .json::<TokenRes>()
            .await
            .context("error parsing token req")?;

        Ok(Self {
            access_token: token_res.access,
            refresh_token: token_res.refresh,
            client,
            base_url,
        })
    }

    pub async fn get_requisition(&self, req_id: &str) -> Result<Requisition, anyhow::Error> {
        let requisition = self
            .client
            .get(format!(
                "{base}/requisitions/{req_id}/",
                base = self.base_url
            ))
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
            .post(format!("{base}/agreements/enduser/", base = self.base_url))
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
            .post(format!(
                "{base}/requisitions/",
                base = self.base_url
            ))
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

    pub async fn delete_integration(&self, integ_id: &str) -> Result<(), anyhow::Error> {
        self.client
            .delete(format!(
                "{base}/requisitions/{id}/",
                base = self.base_url,
                id = integ_id
            ))
            .bearer_auth(&self.access_token)
            .send()
            .await
            .context("error sending DELETE requisitions/{id}/ request")?;

        Ok(())
    }

    pub async fn get_accounts(&self, req_id: &str) -> Result<Vec<String>, anyhow::Error> {
        let requisition = self
            .client
            .get(format!(
                "{base}/requisitions/{req_id}/",
                base = self.base_url
            ))
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
            .get(format!(
                "{base}/accounts/{account_id}/",
                base = self.base_url
            ))
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
            .get(format!(
                "{base}/accounts/{account_id}/transactions/",
                base = self.base_url
            ))
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
pub struct SavedAccount {
    pub id: String,
    pub iban: String,
    pub gcn_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SavedDataGoCardlessNordigen {
    pub institution_id: String,
    pub requisition_id: String,
    pub requisition_link: String,
    pub account_map: Vec<SavedAccount>,
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
