use anyhow::Context;
use chrono::{DateTime, Utc};

use super::{
    op::format_amount,
    parser::{ParsedTransaction, RecordParser},
};

pub struct GenericFormatParser;

impl RecordParser for GenericFormatParser {
    fn delimiter(&self) -> u8 {
        b';'
    }

    fn parse_record(
        &self,
        record: &csv_async::StringRecord,
    ) -> anyhow::Result<super::parser::ParsedTransaction> {
        let date = record.get(0).unwrap_or("").to_string();
        let date = date
            .parse::<DateTime<Utc>>()
            .context("error parsing transaction date")?;

        let amount = record.get(1).unwrap_or("");
        let amount = format_amount(&amount);
        let amount = amount
            .parse::<f32>()
            .context("error parsing transaction amount")?;

        let counter_party = record.get(2).unwrap_or("").to_string();

        let additional = record
            .get(3)
            .filter(|add| !add.is_empty())
            .map(|add| add.to_string());

        let category = record
            .get(4)
            .filter(|cat| !cat.is_empty())
            .map(|cat| cat.to_string());

        Ok(ParsedTransaction {
            date,
            amount,
            counter_party,
            additional,
            category_name: category,
        })
    }
}
