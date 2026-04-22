use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct PushOp {
    pub id: String,
    #[serde(with = "base64_blob")]
    pub blob: Vec<u8>,
    #[serde(rename = "_sync_is_deleted", default)]
    pub is_deleted: bool,
    #[serde(rename = "_sync_edited_at", default)]
    pub edited_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeltaOp {
    pub id: String,
    #[serde(with = "base64_blob")]
    pub blob: Vec<u8>,
    #[serde(rename = "_sync_is_deleted")]
    pub is_deleted: bool,
    #[serde(rename = "_sync_edited_at")]
    pub edited_at: i64,
    pub server_version: i64,
}

#[derive(Debug, Serialize)]
pub struct BootstrapResponse {
    pub entries: Vec<DeltaOp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<i64>,
    /// The server's current max `_sync_server_version` for this user. A client
    /// whose persisted cursor is greater than this has diverged (e.g. server
    /// DB was wiped) and should re-mark all local rows dirty.
    pub server_max_version: i64,
}

mod base64_blob {
    use base64::Engine;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &[u8], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let encoded = base64::engine::general_purpose::STANDARD.encode(value);
        serializer.serialize_str(&encoded)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        base64::engine::general_purpose::STANDARD
            .decode(value.as_bytes())
            .map_err(serde::de::Error::custom)
    }
}
