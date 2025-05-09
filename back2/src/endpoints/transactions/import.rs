use std::{collections::HashMap, io::Cursor};

use anyhow::Context;
use axum::{
    extract::{Multipart, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};

use crate::{
    auth_middleware::User,
    data::create_id,
    error::ApiError,
    state::AppState,
    statement_parsing::{generic::GenericFormatParser, op::OpFormatParser, parser::RecordParser},
};

enum ImportKind {
    Op,
    Generic,
}

// TODO: make more efficient
pub async fn import(
    State(state): State<AppState>,
    user: User,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, ApiError> {
    let mut account_id = None;
    let mut file_data = None;
    let mut kind: Option<ImportKind> = None;

    // collect all fields first before processing
    while let Ok(Some(field)) = multipart.next_field().await {
        if let Some(name) = field.name() {
            match name {
                "account_id" => {
                    account_id = Some(field.text().await.context("error reading account id")?);
                }
                "op_file" => {
                    file_data = Some(field.bytes().await.context("error reading data")?);
                    kind = Some(ImportKind::Op);
                }
                "generic_file" => {
                    file_data = Some(field.bytes().await.context("error reading data")?);
                    kind = Some(ImportKind::Generic);
                }
                _ => continue,
            }
        }
    }

    let account_id =
        account_id.ok_or_else(|| ApiError::BadRequest("Missing account id".to_string()))?;

    let data = file_data.ok_or_else(|| ApiError::BadRequest("Missing file".to_string()))?;

    let parser: Box<dyn RecordParser> = match kind {
        Some(ImportKind::Op) => Box::new(OpFormatParser),
        Some(ImportKind::Generic) => Box::new(GenericFormatParser),
        None => {
            return Err(ApiError::BadRequest("Missing file type".to_string()));
        }
    };

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .delimiter(parser.delimiter())
        .from_reader(data.as_ref());

    let mut buf = Vec::new();
    {
        let mut wtr = csv::WriterBuilder::new()
            .has_headers(false)
            .quote_style(csv::QuoteStyle::Always)
            .from_writer(&mut buf);

        let categories: HashMap<String, String> = HashMap::new();

        for result in reader.records() {
            let record = result.context("error reading record")?;

            let parsed_record = parser.parse_record(&record)?;

            let (category_name, category_id) =
                if let Some(category_name) = parsed_record.category_name {
                    let category_id = categories
                        .get(&category_name)
                        .cloned()
                        .unwrap_or_else(|| create_id());

                    (category_name, category_id)
                } else {
                    ("".to_owned(), "".to_owned())
                };

            let now = Utc::now();

            wtr.write_record(&[
                /* id */ create_id(),
                /* user_id */ user.id.to_owned(),
                /* created_at */ now.to_string(),
                /* date */ parsed_record.date.to_string(),
                /* amount */ parsed_record.amount.to_string(),
                /* currency */ "EUR".to_owned(),
                /* counter_party */ parsed_record.counter_party,
                /* og_counter_party */ parsed_record.og_counter_party,
                /* additional */ parsed_record.additional.unwrap_or_default(),
                /* account_id */ account_id.to_owned(),
                /* category_name */ category_name,
                /* category_id */ category_id,
            ])
            .context("error writing record")?;
        }

        wtr.flush().context("error flushing writer")?;
    }
    let cursor = Cursor::new(buf);

    state
        .data
        .import_tx(&user.id, cursor)
        .await
        .context("error inserting transactions")?;

    Ok(())
}
