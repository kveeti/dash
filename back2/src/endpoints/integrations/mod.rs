use anyhow::{Context, anyhow};
use axum::extract::State;
use chrono::NaiveTime;
use gocardless_nordigen::{GoCardlessNordigen, SavedDataGoCardlessNordigen};
use tracing::info;

use crate::{
    auth_middleware::User,
    data::{InsertTx, create_id},
    error::ApiError,
    state::AppState,
};

pub mod gocardless_nordigen;

pub async fn sync_transactions(State(state): State<AppState>, user: User) -> Result<(), ApiError> {
    let datas = state
        .data
        .get_user_bank_integrations(&user.id)
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
                    let gcn_id = account.gcn_id;

                    let remote_transactions = integ
                        .get_transactions(&gcn_id)
                        .await
                        .context("error getting remote transactions")?;

                    let local_transactions = state
                        .data
                        .get_transactions_by_account_for_sync(&user.id, &account.id)
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
                            new_transactions.push(InsertTx {
                                id: create_id(),
                                currency: "EUR".to_owned(),
                                additional: remote_transaction
                                    .remittance_information_unstructured
                                    .to_owned(),
                                counter_party: counter_party.to_owned(),
                                date: date.and_time(NaiveTime::default()).and_utc(),
                                og_counter_party: counter_party.to_owned(),
                                amount,
                            });
                        }
                    }

                    if new_transactions.is_empty() {
                        info!("no new transactions");
                        continue;
                    }

                    info!("new transactions: {:?}", new_transactions.len());

                    state
                        .data
                        .insert_many_transactions(&user.id, &account.id, new_transactions)
                        .await
                        .context("error inserting transactions")?;
                }
            }
            _ => continue,
        };
    }

    Ok(())
}
