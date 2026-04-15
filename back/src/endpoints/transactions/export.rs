use std::io::{Cursor, Write};

use anyhow::Context;
use axum::{extract::State, response::IntoResponse};
use hyper::{HeaderMap, header};
use zip::{ZipWriter, write::SimpleFileOptions};

use crate::{auth_middleware::LoggedInUser, error::ApiError, state::AppState};

#[tracing::instrument(skip(state))]
pub async fn export(
    State(state): State<AppState>,
    user: LoggedInUser,
) -> Result<impl IntoResponse, ApiError> {
    let (transactions, accounts, categories, links) = tokio::try_join!(
        state.data.export_transactions(&user.id),
        state.data.export_accounts(&user.id),
        state.data.export_categories(&user.id),
        state.data.export_links(&user.id),
    )
    .context("error fetching export data")?;

    let buf = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(buf);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // transactions.csv
    {
        zip.start_file("transactions.csv", opts)
            .context("zip error")?;
        let mut wtr = csv::Writer::from_writer(Vec::new());
        wtr.write_record([
            "id",
            "date",
            "categorize_on",
            "amount",
            "currency",
            "counter_party",
            "additional",
            "notes",
            "category_id",
            "account_id",
        ])
        .context("csv error")?;
        for tx in &transactions {
            wtr.write_record([
                &tx.id,
                &tx.date.to_rfc3339(),
                &tx.categorize_on
                    .map(|d| d.to_rfc3339())
                    .unwrap_or_default(),
                &tx.amount.to_string(),
                &tx.currency,
                &tx.counter_party,
                tx.additional.as_deref().unwrap_or(""),
                tx.notes.as_deref().unwrap_or(""),
                tx.category_id.as_deref().unwrap_or(""),
                tx.account_id.as_deref().unwrap_or(""),
            ])
            .context("csv error")?;
        }
        zip.write_all(&wtr.into_inner().context("csv error")?)
            .context("zip error")?;
    }

    // accounts.csv
    {
        zip.start_file("accounts.csv", opts)
            .context("zip error")?;
        let mut wtr = csv::Writer::from_writer(Vec::new());
        wtr.write_record(["id", "name"]).context("csv error")?;
        for acc in &accounts {
            wtr.write_record([&acc.id, &acc.name])
                .context("csv error")?;
        }
        zip.write_all(&wtr.into_inner().context("csv error")?)
            .context("zip error")?;
    }

    // categories.csv
    {
        zip.start_file("categories.csv", opts)
            .context("zip error")?;
        let mut wtr = csv::Writer::from_writer(Vec::new());
        wtr.write_record(["id", "name", "is_neutral"])
            .context("csv error")?;
        for cat in &categories {
            wtr.write_record([&cat.id, &cat.name, &cat.is_neutral.to_string()])
                .context("csv error")?;
        }
        zip.write_all(&wtr.into_inner().context("csv error")?)
            .context("zip error")?;
    }

    // links.csv
    {
        zip.start_file("links.csv", opts).context("zip error")?;
        let mut wtr = csv::Writer::from_writer(Vec::new());
        wtr.write_record(["transaction_a_id", "transaction_b_id"])
            .context("csv error")?;
        for link in &links {
            wtr.write_record([&link.transaction_a_id, &link.transaction_b_id])
                .context("csv error")?;
        }
        zip.write_all(&wtr.into_inner().context("csv error")?)
            .context("zip error")?;
    }

    let result = zip.finish().context("zip error")?;
    let bytes = result.into_inner();

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/zip".parse().unwrap());
    headers.insert(
        header::CONTENT_DISPOSITION,
        "attachment; filename=\"transactions-export.zip\""
            .parse()
            .unwrap(),
    );

    Ok((headers, bytes))
}
