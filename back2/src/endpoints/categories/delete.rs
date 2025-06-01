use crate::error::ApiError;
use crate::{auth_middleware::LoggedInUser, state::AppState};
use axum::extract::Path;
use axum::extract::State;
use axum::response::IntoResponse;
use http::StatusCode;

#[utoipa::path(
    delete,
    path = "/categories/{id}",
    operation_id = "categories/delete",
    params(
        ("id" = String, description = "category id"),
    ),
    responses(
        (status = 204),
        (status = 400),
    )
)]
pub async fn delete(
    State(state): State<AppState>,
    user: LoggedInUser,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let was_deleted = state.data.delete_category_if_unused(&user.id, &id).await?;

    if was_deleted {
        Ok((StatusCode::NO_CONTENT).into_response())
    } else {
        Err(ApiError::BadRequest(
            "cannot delete a category with transactions".to_string(),
        ))
    }
}
