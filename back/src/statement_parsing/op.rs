use anyhow::{Context, Result};
use chrono::{NaiveDate, NaiveTime, Utc};

use super::parser::{ParsedTransaction, RecordParser};

pub struct OpFormatParser;

impl RecordParser for OpFormatParser {
    fn parse_record(&self, record: &csv_async::StringRecord) -> Result<ParsedTransaction> {
        let date = match record.get(0).filter(|s| !s.is_empty()) {
            Some(date_str) => {
                let naive_date = date_str
                    .parse::<NaiveDate>()
                    .context(format!("error parsing transaction date {date_str}"))?;
                naive_date.and_time(NaiveTime::default()).and_utc()
            }
            None => Utc::now(),
        };

        let amount = record.get(2).unwrap_or("");
        let amount = format_amount(&amount);

        let counter_party = match record.get(5).filter(|s| !s.is_empty()) {
            Some(name) => name.to_string(),
            None => {
                // TODO: this WILL break syncing for these transactions btw.
                // look into what integrations return for these kind of transactions
                // where OP account statement has an empty counter party
                // eg Selitys: KÄTEISPANO had it empty
                "NONAME".to_string()
            }
        };

        let additional = build_additional_field(record);

        Ok(ParsedTransaction {
            date,
            amount: amount.parse().context("error parsing transaction amount")?,
            counter_party,
            additional: Some(additional),
            category_name: None,
        })
    }

    fn delimiter(&self) -> u8 {
        b';'
    }
}

fn build_additional_field(record: &csv_async::StringRecord) -> String {
    let mut additional = String::new();

    fn append_field(additional: &mut String, label: &str, value: Option<&str>) {
        if let Some(value) = value {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                if !additional.is_empty() {
                    additional.push_str(", ");
                }
                additional.push_str(&format!("{}: {}", label, trimmed));
            }
        }
    }

    append_field(&mut additional, "Selitys", record.get(4));
    append_field(&mut additional, "Saajan tilinumero", record.get(6));

    if let Some(value) = record.get(9) {
        let cleaned_viesti = if value.starts_with("Viesti:") {
            value[7..].trim().to_string()
        } else {
            value.trim().to_string()
        };
        if !cleaned_viesti.is_empty() {
            if !additional.is_empty() {
                additional.push_str(", ");
            }
            additional.push_str(&format!("Viesti: {}", cleaned_viesti));
        }
    }

    if let Some(value) = record.get(8) {
        let cleaned_viite = if value.starts_with("ref=") {
            value[4..].trim().to_string()
        } else {
            value.trim().to_string()
        };
        if !cleaned_viite.is_empty() {
            if !additional.is_empty() {
                additional.push_str(", ");
            }
            additional.push_str(&format!("Viite: {}", cleaned_viite));
        }
    }
    append_field(&mut additional, "Laji", record.get(3));
    append_field(&mut additional, "Saajan pankin BIC", record.get(7));
    append_field(&mut additional, "Arkistointitunnus", record.get(10));
    append_field(&mut additional, "Arvopäivä", record.get(1));

    additional
}

pub fn format_amount(amount: &str) -> String {
    let amount = amount.replace(&['–', '—'][..], "−");
    let amount = amount.replace(',', ".").trim().to_string();
    amount
}
