use anyhow::{Context, Result};

use super::parser::{ParsedTransaction, RecordParser};

pub struct OpFormatParser;

impl RecordParser for OpFormatParser {
    fn parse_record(&self, record: &csv::StringRecord) -> Result<ParsedTransaction> {
        let date = record.get(0).unwrap_or("").to_string();

        let amount = record.get(2).unwrap_or("");
        let amount = format_amount(&amount);

        let name = record.get(5).unwrap_or("");
        let cleaned_name = name
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();

        let additional = build_additional_field(record);

        Ok(ParsedTransaction {
            date: date.parse().context("error parsing transaction date")?,
            amount: amount.parse().context("error parsing transaction amount")?,
            counter_party: cleaned_name,
            additional,
        })
    }

    fn delimiter(&self) -> u8 {
        b';'
    }
}

fn build_additional_field(record: &csv::StringRecord) -> String {
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

fn format_amount(amount: &str) -> String {
    let amount = amount.replace(&['–', '—'][..], "−");
    let amount = amount.replace(',', ".").trim().to_string();
    amount
}
