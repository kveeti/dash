use anyhow::{Context, Result};
use axum::{Json, extract::State, response::IntoResponse};

use crate::{auth_middleware::User, data::create_id, error::ApiError, state::AppState};

#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema, Debug, utoipa::IntoParams)]
pub struct CreateTx {
    pub name: String,
}

#[utoipa::path(
    post,
    path = "/accounts",
    request_body(
        content = CreateTx,
        content_type = "application/json",
    ),
    responses(
        (status = 201, body = ())
    )
)]
pub async fn create(
    State(state): State<AppState>,
    user: User,
    Json(payload): Json<CreateTx>,
) -> Result<impl IntoResponse, ApiError> {
    let account_id = create_id();

    state
        .data
        .insert_account(&user.id, &account_id, &payload.name)
        .await
        .context("error inserting account")?;

    Ok(())
}
