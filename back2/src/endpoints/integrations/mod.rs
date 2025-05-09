use anyhow::{Context, anyhow};
use axum::{Json, extract::State};
use chrono::{TimeZone, Utc};
use gocardless_nordigen::{GoCardlessNordigen, SavedDataGoCardlessNordigen};
use serde::Deserialize;
use tracing::info;

use crate::{
    auth_middleware::User,
    data::{InsertTx, create_id},
    error::ApiError,
    state::AppState,
};

pub mod gocardless_nordigen;

#[derive(Deserialize, Debug)]
pub struct Input {
    pub account_id: String,
}

pub async fn sync_transactions(
    State(state): State<AppState>,
    user: User,
    Json(input): Json<Input>,
) -> Result<(), ApiError> {
    let datas = state
        .data
        .user_bank_integrations
        .get_by_user(&user.id)
        .await
        .context("error getting user bank integration data")?;

    if datas.is_empty() {
        info!("user has no connected integrations");
        return Ok(());
    }

    for data in datas {
        let (integ, _) = data
            .name
            .split_once("::")
            .ok_or_else(|| anyhow!("error parsing saved name"))?;

        match integ {
            "gocardless-nordigen" => {
                let data = serde_json::from_value::<SavedDataGoCardlessNordigen>(data.data)
                    .context("error parsing saved data")?;

                if data.account_map.is_empty() {
                    info!("no accounts to sync");
                    continue;
                }

                let integ = GoCardlessNordigen::new(&state.config)
                    .await
                    .context("error initializing integration")?;

                for account in data.account_map {
                    let account_id = account.0;
                    let account_iban = account.1;

                    let remote_transactions = integ
                        .get_transactions(&account_id)
                        .await
                        .context("error getting remote transactions")?;

                    let local_transactions = state
                        .data
                        .transactions
                        .get_by_account_for_sync(&user.id, &account_iban)
                        .await
                        .context("error getting local transactions")?;

                    let mut new_transactions = vec![];

                    for remote_transaction in remote_transactions {
                        let mut found = false;

                        let date = chrono::NaiveDate::parse_from_str(
                            &remote_transaction.value_date,
                            "%Y-%m-%d",
                        )
                        .context("error parsing date")?;

                        let amount = remote_transaction
                            .transaction_amount
                            .amount
                            .parse::<f32>()
                            .context("error parsing amount")?;

                        let counter_party = remote_transaction.creditor_name.unwrap_or(
                            remote_transaction
                                .debtor_name
                                .unwrap_or("Unknown".to_owned()),
                        );

                        for local_transaction in &local_transactions {
                            if *counter_party == local_transaction.og_counter_party
                                && local_transaction.date.date_naive() == date
                                && local_transaction.amount == amount
                            {
                                found = true;
                                break;
                            }
                        }

                        if !found {
                            // new_transactions.push(InsertTx {
                            //     id: create_id(),
                            //     currency: "EUR".to_owned(),
                            //     additional: remote_transaction
                            //         .remittance_information_unstructured
                            //         .to_owned(),
                            //     counter_party: counter_party.to_owned(),
                            //     date: Utc.from_utc_datetime(
                            //         &date
                            //             .and_hms_opt(0, 0, 0)
                            //             .context("error creating datetime")?,
                            //     ),
                            //     amount,
                            // });
                        }
                    }

                    if new_transactions.is_empty() {
                        info!("no new transactions");
                        continue;
                    }

                    info!("new transactions: {:?}", new_transactions.len());

                    state
                        .data
                        .transactions
                        .insert_many(&user.id, &input.account_id, new_transactions)
                        .await
                        .context("error inserting transactions")?;
                }
            }
            _ => continue,
        };
    }

    Ok(())
}
