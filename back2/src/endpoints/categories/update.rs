use std::collections::HashMap;

use axum::{
    Json,
    extract::{Path, State},
    response::IntoResponse,
};
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{auth_middleware::LoggedInUser, error::ApiError, state::AppState};

#[derive(Deserialize, ToSchema)]
pub struct CategoryUpdateInput {
    pub name: String,
    pub is_neutral: bool,
}

#[utoipa::path(
    patch,
    path = "/v1/categories/{id}",
    operation_id = "v1/categories/update",
    params(
        ("id" = String, description = "category id"),
    ),
    request_body(
        content = CategoryUpdateInput,
        content_type = "application/json",
    ),
    responses(
        (status = 200, body = ()),
    )
)]
pub async fn update(
    State(state): State<AppState>,
    user: LoggedInUser,
    Path(id): Path<String>,
    Json(payload): Json<CategoryUpdateInput>,
) -> Result<impl IntoResponse, ApiError> {
    let mut errors: HashMap<String, String> = HashMap::new();

    let name = payload.name.trim();
    if name.is_empty() {
        errors.insert("name".to_owned(), "required".to_owned());
    } else if name.len() > 50 {
        errors.insert("name".to_owned(), "must be shorter than 50".to_owned());
    }

    state
        .data
        .update_category(&user.id, &id, name, payload.is_neutral)
        .await?;

    Ok(())
}
