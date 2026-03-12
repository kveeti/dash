use anyhow::{Context, anyhow};
use axum::extract::State;
use chrono::{NaiveTime, Utc};
use tracing::info;

use crate::{
    auth_middleware::LoggedInUser,
    data::{InsertTx, SavedDataEnvelope, create_id},
    endpoints::integrations::enable_banking::{self, SavedDataEnableBanking},
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

    for integration in datas {
        let name = integration.name.clone();
        match serde_json::from_value(integration.data).expect("deserializing data") {
            SavedDataEnvelope::GocardlessNordigen { data } => {
                sync_gocardless_nordigen(&user, &state, &name, data).await?
            }
            SavedDataEnvelope::EnableBanking { data } => {
                sync_enable_banking(&user, &state, data).await?
            }
        };
    }

    Ok(())
}

async fn sync_gocardless_nordigen(
    user: &LoggedInUser,
    state: &AppState,
    name: &str,
    inner: SavedDataGoCardlessNordigen,
) -> Result<(), anyhow::Error> {
    if inner.account_map.is_empty() {
        info!("no accounts to sync");
        return Ok(());
    }

    let integ = GoCardlessNordigen::new(&state.config)
        .await
        .context("error initializing integration")?;

    let mut current_account_map = inner.account_map.clone();

    let now = Utc::now().date_naive();

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

            let date =
                chrono::NaiveDate::parse_from_str(&remote_transaction.value_date, "%Y-%m-%d")
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
                    categorize_on: None,
                    amount,
                    notes: None,
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
        let new_bank_integ_data =
            serde_json::to_value(new_bank_integ_data).context("error serializing new data")?;

        if new_transactions.is_empty() {
            info!("no new transactions");
            state
                .data
                .set_user_bank_integration(&user.id, name, new_bank_integ_data)
                .await
                .context("error updating db")?;
            return Ok(());
        }

        info!("new transactions: {:?}", new_transactions.len());

        state
            .data
            .insert_many_transactions_and_user_bank_integration(
                &user.id,
                &account.id,
                new_transactions,
                name,
                new_bank_integ_data,
            )
            .await
            .context("error updating db")?;
    }

    Ok(())
}

async fn sync_enable_banking(
    user: &LoggedInUser,
    state: &AppState,
    data: SavedDataEnableBanking,
) -> Result<(), anyhow::Error> {
    if data.accounts.is_empty() {
        info!("no accounts to sync");
        return Ok(());
    }

    let eb_config = state
        .config
        .eb
        .as_ref()
        .ok_or_else(|| anyhow!("enable banking not configured"))?;

    let integration_name = data.session_id.clone();
    let mut current_accounts = data.accounts.clone();
    let now = Utc::now().date_naive();

    for (idx, account) in data.accounts.iter().enumerate() {
        let iban = &account.account_id.iban;
        let account_id = state
            .data
            .get_account_id_by_external_id(&user.id, iban)
            .await
            .context("error looking up account")?
            .ok_or_else(|| anyhow!("account not found for iban {iban}"))?;

        let remote_transactions =
            enable_banking::get_transactions(eb_config, &account.uid, account.last_synced_at)
                .await
                .context("error getting remote transactions")?;

        let local_transactions = state
            .data
            .get_transactions_by_account_for_sync(&user.id, &account_id)
            .await
            .context("error getting local transactions")?;

        let mut new_transactions = vec![];

        for remote_tx in remote_transactions {
            // Only process booked and instant balance transactions
            let status = remote_tx.status.as_deref().unwrap_or("BOOK");
            if status != "BOOK" && status != "PDNG" {
                continue;
            }

            let date_str = remote_tx
                .booking_date
                .or(remote_tx.value_date)
                .ok_or_else(|| anyhow!("transaction has no date"))?;
            let date = chrono::NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
                .context("error parsing date")?;

            let mut amount = remote_tx
                .transaction_amount
                .amount
                .parse::<f32>()
                .context("error parsing amount")?;

            if remote_tx.credit_debit_indicator.as_deref() == Some("DBIT") {
                amount = -amount.abs();
            }

            let counter_party = remote_tx
                .creditor
                .and_then(|p| p.name)
                .or_else(|| remote_tx.debtor.and_then(|p| p.name))
                .unwrap_or_else(|| "Unknown".to_owned());

            let mut found = false;
            for local_tx in &local_transactions {
                if counter_party == local_tx.counter_party
                    && local_tx.amount == amount
                    && local_tx.date.date_naive() == date
                {
                    found = true;
                    break;
                }
            }

            if !found {
                let additional = remote_tx
                    .remittance_information
                    .map(|info| info.join(" "));

                new_transactions.push(InsertTx {
                    id: create_id(),
                    currency: remote_tx.transaction_amount.currency,
                    additional,
                    counter_party,
                    date: date.and_time(NaiveTime::default()).and_utc(),
                    categorize_on: None,
                    amount,
                    notes: None,
                });
            }
        }

        current_accounts[idx].last_synced_at = Some(now);

        let new_saved_data = SavedDataEnableBanking {
            session_id: data.session_id.clone(),
            accounts: current_accounts.clone(),
            aspsp: data.aspsp.clone(),
        };
        let new_saved_data = serde_json::to_value(crate::data::SavedDataEnvelope::EnableBanking {
            data: new_saved_data,
        })
        .context("error serializing new data")?;

        if new_transactions.is_empty() {
            info!("no new transactions");
            state
                .data
                .set_user_bank_integration(&user.id, &integration_name, new_saved_data)
                .await
                .context("error updating db")?;
            continue;
        }

        info!("new transactions: {:?}", new_transactions.len());

        state
            .data
            .insert_many_transactions_and_user_bank_integration(
                &user.id,
                &account_id,
                new_transactions,
                &integration_name,
                new_saved_data,
            )
            .await
            .context("error updating db")?;
    }

    Ok(())
}
