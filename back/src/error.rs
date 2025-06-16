use std::collections::HashMap;

use axum::{
    Json,
    response::{IntoResponse, Response},
};
use hyper::StatusCode;
use serde::Serialize;
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

    #[error("bad request (details): {0}")]
    BadRequestDetails(String, ErrorDetails),
}

#[derive(Debug, Serialize)]
pub struct ErrorDetails(pub HashMap<String, String>);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        tracing::error!("{:#?}", self);

        let (status_code, error_message, details) = match self {
            ApiError::UnexpectedError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Some("unexpected error".to_string()),
                None,
            ),
            ApiError::NoAuth(_) => (StatusCode::UNAUTHORIZED, None, None),
            ApiError::NoAccess(details) => (StatusCode::FORBIDDEN, Some(details), None),
            ApiError::NotFound(_) => (StatusCode::NOT_FOUND, None, None),
            ApiError::BadRequest(err) => (StatusCode::BAD_REQUEST, Some(err.to_string()), None),
            ApiError::BadRequestDetails(err, details) => (
                StatusCode::BAD_REQUEST,
                Some(err.to_string()),
                Some(details),
            ),
        };

        return (
            status_code,
            Json(json!({ "error": error_message, "details": details })),
        )
            .into_response();
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        return ApiError::UnexpectedError(anyhow::anyhow!(err));
    }
}
