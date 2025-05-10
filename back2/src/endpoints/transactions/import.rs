use std::{
    collections::HashMap,
    io::{self},
};

use anyhow::Context;
use axum::{
    extract::{Multipart, Path, State},
    response::IntoResponse,
};
use chrono::Utc;
use csv_async::{AsyncReaderBuilder, StringRecord};
use futures::{StreamExt, TryStreamExt};
use http::StatusCode;
use tokio_util::io::StreamReader;

use crate::{
    auth_middleware::User,
    data::create_id,
    error::ApiError,
    state::AppState,
    statement_parsing::{generic::GenericFormatParser, op::OpFormatParser, parser::RecordParser},
};

#[derive(Debug)]
enum ImportKind {
    Op,
    Generic,
}

// TODO: make more efficient
pub async fn import(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    user: User,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, ApiError> {
    let pg_pool = state.data.clone().get_pg_pool();
    let mut conn = pg_pool
        .acquire()
        .await
        .context("error acquiring connection")?;

    let mut copy_in = conn
        .copy_in_raw(
            r#"
            COPY transaction_imports (
                id,
                import_id,
                user_id,
                created_at,
                date,
                amount,
                currency,
                counter_party,
                og_counter_party,
                additional,
                account_id,
                category_name,
                category_id
            ) FROM STDIN WITH NULL as '' csv
            "#,
        )
        .await?;

    while let Ok(Some(field)) = multipart.next_field().await {
        if let Some(name) = field.name() {
            match name {
                "op_file" | "generic_file" => {
                    let kind = match name {
                        "op_file" => ImportKind::Op,
                        "generic_file" => ImportKind::Generic,
                        _ => continue,
                    };

                    let stream = field
                        .map_err(|err| io::Error::new(io::ErrorKind::Other, err))
                        .map_ok(|bytes| bytes)
                        .into_stream();

                    let reader = StreamReader::new(stream.map(|result| {
                        result.map_err(|err| io::Error::new(io::ErrorKind::Other, err))
                    }));

                    let parser: Box<dyn RecordParser> = match kind {
                        ImportKind::Op => Box::new(OpFormatParser),
                        ImportKind::Generic => Box::new(GenericFormatParser),
                    };

                    let mut csv_reader = AsyncReaderBuilder::new()
                        .flexible(true)
                        .delimiter(parser.delimiter())
                        .has_headers(false)
                        .create_reader(reader);

                    let now = Utc::now();
                    let categories: HashMap<String, String> = HashMap::new();
                    let mut rows = 0;
                    let import_id = create_id();
                    let mut line_buffer: Vec<Vec<u8>> = Vec::new();
                    let mut record = StringRecord::new();
                    loop {
                        let result = csv_reader.read_record(&mut record).await;

                        let has_record = result.context("error parsing record")?;
                        if !has_record {
                            break;
                        }

                        let parsed = parser
                            .parse_record(&record)
                            .context("error parsing record")?;

                        let (category_name, category_id) =
                            if let Some(category_name) = parsed.category_name {
                                let category_id = categories
                                    .get(&category_name)
                                    .cloned()
                                    .unwrap_or_else(|| create_id());

                                (Some(category_name), Some(category_id))
                            } else {
                                (None, None)
                            };

                        let parsed = &[
                            /* id */ create_id(),
                            /* import_id */ import_id.to_owned(),
                            /* user_id */ user.id.to_owned(),
                            /* created_at */ now.to_rfc3339(),
                            /* date */ parsed.date.to_rfc3339(),
                            /* amount */ parsed.amount.to_string(),
                            /* currency */ "EUR".to_owned(),
                            /* counter_party */ parsed.counter_party,
                            /* og_counter_party */ parsed.og_counter_party,
                            /* additional */ parsed.additional.unwrap_or_default(),
                            /* account_id */ account_id.to_owned(),
                            /* category_name */
                            category_name.unwrap_or("".to_owned()),
                            /* category_id */ category_id.unwrap_or("".to_owned()),
                        ];

                        let mut wtr = csv::WriterBuilder::new()
                            .has_headers(false)
                            .quote_style(csv::QuoteStyle::Necessary)
                            .from_writer(vec![]);

                        wtr.write_record(parsed).context("error writing record")?;

                        let line = wtr.into_inner().context("error finishing line")?;

                        line_buffer.push(line);
                        if line_buffer.len() >= 100 {
                            let batch = std::mem::take(&mut line_buffer);
                            copy_in
                                .send(batch.concat())
                                .await
                                .context("error sending batch")?;
                            rows += 100;
                        }
                    }

                    if !line_buffer.is_empty() {
                        copy_in
                            .send(line_buffer.concat())
                            .await
                            .context("error sending remaining lines")?;
                    }

                    copy_in.finish().await.context("error finishing copying")?;
                    conn.close().await.context("error closing connection")?;
                    drop(pg_pool);

                    state
                        .data
                        .import_tx_phase_2(&user.id, &import_id)
                        .await
                        .context("error finishing import")?;

                    return Ok((StatusCode::OK).into_response());
                }
                _ => return Err(ApiError::BadRequest("Invalid request".to_string())),
            }
        } else {
            return Err(ApiError::BadRequest("Invalid request".to_string()));
        }
    }

    return Err(ApiError::BadRequest("Invalid request".to_string()));
}
