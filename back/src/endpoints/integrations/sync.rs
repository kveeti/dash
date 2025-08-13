use anyhow::{Context, anyhow};
use axum::extract::State;
use chrono::{NaiveTime, Utc};
use tracing::info;

use crate::{
    auth_middleware::LoggedInUser,
    data::{InsertTx, create_id},
    error::ApiError,
    state::AppState,
};

use super::gocardless_nordigen::{GoCardlessNordigen, SavedDataGoCardlessNordigen};

#[cfg_attr(feature = "docs", utoipa::path(
    post,
    path = "/v1/integrations/sync",
    operation_id = "v1/integrations/sync",
    responses(
        (status = 200, body = ()),
    )
))]
#[tracing::instrument(skip(state))]
pub async fn sync(State(state): State<AppState>, user: LoggedInUser) -> Result<(), ApiError> {
    let datas = state
        .data
        .get_user_bank_integrations(&user.id)
        .await
        .context("error getting user bank integration data")?;

    if datas.is_empty() {
        info!("user has no connected integrations");
        return Ok(());
    }

    let now = Utc::now().date_naive();

    for data in datas {
        let (integ, _) = data
            .name
            .split_once("::")
            .ok_or_else(|| anyhow!("error parsing saved name"))?;

        match integ {
            "gocardless-nordigen" => {
                let inner = serde_json::from_value::<SavedDataGoCardlessNordigen>(data.data)
                    .context("error parsing saved data")?;

                if inner.account_map.is_empty() {
                    info!("no accounts to sync");
                    continue;
                }

                let integ = GoCardlessNordigen::new(&state.config)
                    .await
                    .context("error initializing integration")?;

                let mut current_account_map = inner.account_map.clone();

                for (idx, account) in inner.account_map.iter().enumerate() {
                    // TODO: better solution for situation where user
                    //       has not used syncing before so they have an account
                    //       most likely with a different iban/name than the account
                    //       they're going to sync. And because how the bank connection
                    //       is set up atm, the exp is not good there. It will effectively
                    //       sync transactions on the new empty account

                    // TODO: maybe communicate sync status/result to the user

                    // TODO: maybe make syncing a bg job, then status is needed

                    // TODO: some pagination for local transactions at least.
                    //       GCN does not support pagination
                    let remote_transactions = integ
                        .get_transactions(&account.gcn_id, account.last_synced_at)
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
                            if *counter_party == local_transaction.counter_party
                                && local_transaction.amount == amount
                                && local_transaction.date.date_naive() == date
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
                                amount,
                            });
                        }
                    }

                    current_account_map[idx].last_synced_at = Some(now);

                    let new_bank_integ_data = SavedDataGoCardlessNordigen {
                        account_map: current_account_map.clone(),
                        institution_id: inner.institution_id.to_owned(),
                        requisition_id: inner.requisition_id.to_owned(),
                        requisition_link: inner.requisition_link.to_owned(),
                    };
                    let new_bank_integ_data = serde_json::to_value(new_bank_integ_data)
                        .context("error serializing new data")?;

                    if new_transactions.is_empty() {
                        info!("no new transactions");
                        state
                            .data
                            .set_user_bank_integration(&user.id, &data.name, new_bank_integ_data)
                            .await
                            .context("error updating db")?;
                        continue;
                    }

                    info!("new transactions: {:?}", new_transactions.len());

                    state
                        .data
                        .insert_many_transactions_and_user_bank_integration(
                            &user.id,
                            &account.id,
                            new_transactions,
                            &data.name,
                            new_bank_integ_data,
                        )
                        .await
                        .context("error updating db")?;
                }
            }
            _ => continue,
        };
    }

    Ok(())
}
