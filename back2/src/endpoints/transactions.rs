use axum::response::IntoResponse;

use crate::error::ApiError;

pub async fn stats() -> Result<impl IntoResponse, ApiError> {
    Ok(())
}

pub async fn query() -> Result<impl IntoResponse, ApiError> {
    Ok(())
}

pub async fn create() -> Result<impl IntoResponse, ApiError> {
    Ok(())
}

pub async fn update() -> Result<impl IntoResponse, ApiError> {
    Ok(())
}

pub async fn delete() -> Result<impl IntoResponse, ApiError> {
    Ok(())
}

pub async fn link() -> Result<impl IntoResponse, ApiError> {
    Ok(())
}

pub async fn unlink() -> Result<impl IntoResponse, ApiError> {
    Ok(())
}
