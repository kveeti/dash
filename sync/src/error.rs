use axum::{Json, response::{IntoResponse, Response}};
use hyper::StatusCode;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error(transparent)]
    UnexpectedError(#[from] anyhow::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("conflict: {0}")]
    Conflict(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status_code, error_message) = match self {
            ApiError::UnexpectedError(ref err) => {
                tracing::error!("unexpected error: {err:#}");

                #[cfg(debug_assertions)]
                let msg = format!("{err:#}");
                #[cfg(not(debug_assertions))]
                let msg = "unexpected error".to_string();

                (StatusCode::INTERNAL_SERVER_ERROR, msg)
            }
            ApiError::NotFound(_) => (StatusCode::NOT_FOUND, "not found".to_string()),
            ApiError::BadRequest(err) => (StatusCode::BAD_REQUEST, err),
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized".to_string()),
            ApiError::Conflict(msg) => (StatusCode::CONFLICT, msg),
        };

        (status_code, Json(json!({ "error": error_message }))).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        ApiError::UnexpectedError(anyhow::anyhow!(err))
    }
}
