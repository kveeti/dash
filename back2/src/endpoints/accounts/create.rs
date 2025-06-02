use std::collections::HashMap;

use anyhow::{Context, Result};
use axum::{Json, extract::State, response::IntoResponse};
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{
    auth_middleware::LoggedInUser,
    data::create_id,
    error::{ApiError, ErrorDetails},
    state::AppState,
};

#[derive(Deserialize, ToSchema)]
pub struct CreateAccountInput {
    pub name: String,
}

#[utoipa::path(
    post,
    path = "/v1/accounts",
    operation_id = "v1/accounts/create",
    request_body(
        content = CreateAccountInput,
        content_type = "application/json",
    ),
    responses(
        (status = 201, body = ())
    )
)]
pub async fn create(
    State(state): State<AppState>,
    user: LoggedInUser,
    Json(payload): Json<CreateAccountInput>,
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

    let account_id = create_id();

    state
        .data
        .insert_account(&user.id, &account_id, &name)
        .await
        .context("error inserting account")?;

    Ok(())
}
