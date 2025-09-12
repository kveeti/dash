use std::collections::HashMap;

use anyhow::{Context, Result};
use axum::{Json, extract::State, response::IntoResponse};
use serde::Deserialize;

use crate::{
    auth_middleware::LoggedInUser,
    data::{TxCategory, create_id},
    error::{ApiError, ErrorDetails},
    state::AppState,
};

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct CreateCategoryInput {
    pub name: String,
    pub is_neutral: bool,
}

#[cfg_attr(feature = "docs", utoipa::path(
    post,
    path = "/v1/categories",
    operation_id = "v1/categories/create",
    request_body(
        content = CreateCategoryInput,
        content_type = "application/json",
    ),
    responses(
        (status = 201, body = TxCategory)
    )
))]
#[tracing::instrument(skip(state))]
pub async fn create(
    State(state): State<AppState>,
    user: LoggedInUser,
    Json(payload): Json<CreateCategoryInput>,
) -> Result<impl IntoResponse, ApiError> {
    let mut errors: HashMap<String, String> = HashMap::new();

    let name = payload.name.trim();
    if name.is_empty() {
        errors.insert("name".to_owned(), "required".to_owned());
    } else if name.len() > 50 {
        errors.insert("name".to_owned(), "must be shorter than 50".to_owned());
    }

    if !errors.is_empty() {
        return Err(ApiError::BadRequestDetails(
            "invalid request".to_owned(),
            ErrorDetails(errors),
        ));
    }

    let category_id = create_id();

    state
        .data
        .insert_category(&user.id, &category_id, &name, payload.is_neutral)
        .await
        .context("error inserting category")?;

    Ok(Json(TxCategory {
        id: category_id.clone(),
        name: name.to_owned(),
        is_neutral: payload.is_neutral,
    }))
}
