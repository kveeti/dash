use axum::{
    Json,
    response::{IntoResponse, Response},
};
use hyper::StatusCode;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error(transparent)]
    UnexpectedError(#[from] anyhow::Error),

    #[error("no access: {0}")]
    NoAccess(String),

    #[error("no auth: {0}")]
    NoAuth(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("bad request: {0}")]
    BadRequest(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        tracing::error!("{:#?}", self);

        let (status_code, error_message) = match self {
            ApiError::UnexpectedError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Some("unexpected error".to_string()),
            ),
            ApiError::NoAuth(_) => (StatusCode::UNAUTHORIZED, None),
            ApiError::NoAccess(_) => (StatusCode::FORBIDDEN, None),
            ApiError::NotFound(_) => (StatusCode::NOT_FOUND, None),
            ApiError::BadRequest(err) => (StatusCode::BAD_REQUEST, Some(err.to_string())),
        };

        return (status_code, Json(json!({ "error": error_message }))).into_response();
    }
}
