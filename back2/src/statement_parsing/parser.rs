use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ParsedTransaction {
    pub date: DateTime<Utc>,
    pub amount: f32,
    pub counter_party: String,
    pub og_counter_party: String,
    pub additional: Option<String>,
    pub category_name: Option<String>,
}

pub trait RecordParser: Sync + Send {
    fn parse_record(&self, record: &csv_async::StringRecord) -> Result<ParsedTransaction>;
    fn delimiter(&self) -> u8;
}
