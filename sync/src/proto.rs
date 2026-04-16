use serde::{Deserialize, Serialize};

/// Inbound op from a client push. Blob is an opaque base64-encoded
/// ciphertext — the server never interprets it.
#[derive(Debug, Clone, Deserialize)]
pub struct PushOp {
    pub id: String,
    #[serde(rename = "_sync_hlc")]
    pub hlc: String,
    pub blob: String,
    #[serde(rename = "_sync_is_deleted", default)]
    pub is_deleted: bool,
}

/// Outbound op included in a delta / bootstrap page.
#[derive(Debug, Clone, Serialize)]
pub struct DeltaOp {
    pub id: String,
    #[serde(rename = "_sync_hlc")]
    pub hlc: String,
    pub blob: String,
    #[serde(rename = "_sync_is_deleted")]
    pub is_deleted: bool,
    pub server_version: i64,
}

/// Messages the client sends over the WS.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Push {
        batch_id: String,
        ops: Vec<PushOp>,
    },
}

/// Messages the server sends over the WS.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Ready,
    Delta {
        #[serde(skip_serializing_if = "Option::is_none")]
        ack_for: Option<String>,
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
