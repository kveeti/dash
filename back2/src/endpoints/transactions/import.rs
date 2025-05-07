use anyhow::Context;
use axum::{
    extract::{Multipart, State},
    response::IntoResponse,
};

use crate::{
    auth_middleware::User,
    data::{InsertTx, create_id},
    error::ApiError,
    state::AppState,
    statement_parsing::{op::OpFormatParser, parser::RecordParser},
};

// TODO: make more efficient
pub async fn import(
    State(state): State<AppState>,
    user: User,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, ApiError> {
    let mut records: Vec<InsertTx> = Vec::new();
    let mut account_id = None;
    let mut file_data = None;

    // collect all fields first before processing
    while let Ok(Some(field)) = multipart.next_field().await {
        if let Some(name) = field.name() {
            match name {
                "account_id" => {
                    account_id = Some(field.text().await.context("error reading account id")?);
                }
                "file" => {
                    file_data = Some(field.bytes().await.context("error reading data")?);
                }
                _ => continue,
            }
        }
    }

    let account_id =
        account_id.ok_or_else(|| ApiError::BadRequest("Missing account id".to_string()))?;

    let data = file_data.ok_or_else(|| ApiError::BadRequest("Missing file".to_string()))?;

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .delimiter(b';')
        .from_reader(data.as_ref());

    for result in reader.records() {
        let record = result.context("error reading record")?;

        let parsed_record = OpFormatParser.parse_record(&record)?;

        let additional = if parsed_record.additional.is_empty() {
            None
        } else {
            Some(parsed_record.additional)
        };

        records.push(InsertTx {
            id: create_id(),
            amount: parsed_record.amount,
            counter_party: parsed_record.counter_party,
            date: parsed_record.date,
            additional,
            currency: "EUR".to_owned(),
        });
    }

    state
        .data
        .transactions
        .insert_many(&user.id, &account_id, records)
        .await
        .context("error inserting transactions")?;

    Ok(())
}
