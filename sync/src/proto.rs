use serde::{Deserialize, Serialize};

/// Inbound op from a client push. Blob is an opaque ciphertext — the server
/// never interprets it.
#[derive(Debug, Clone, Deserialize)]
pub struct PushOp {
    pub id: String,
    #[serde(rename = "_sync_hlc")]
    pub hlc: String,
    #[serde(with = "base64_blob")]
    pub blob: Vec<u8>,
    #[serde(rename = "_sync_is_deleted", default)]
    pub is_deleted: bool,
}

/// Outbound op included in a delta / bootstrap page.
#[derive(Debug, Clone, Serialize)]
pub struct DeltaOp {
    pub id: String,
    #[serde(rename = "_sync_hlc")]
    pub hlc: String,
    #[serde(with = "base64_blob")]
    pub blob: Vec<u8>,
    #[serde(rename = "_sync_is_deleted")]
    pub is_deleted: bool,
    pub server_version: i64,
}

/// Messages the server sends over the WS.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Ready,
    Delta {
        #[serde(skip_serializing_if = "Option::is_none")]
        ack_for: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        ack_max_version: Option<i64>,
        ops: Vec<DeltaOp>,
    },
    Error {
        code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
}

/// GET /bootstrap response shape.
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
