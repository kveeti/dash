use axum::{Json, extract::State, response::IntoResponse};

use crate::{auth_middleware::User, data::QueryTx, error::ApiError, services, state::AppState};

#[utoipa::path(
    get,
    path = "/transactions",
    responses(
        (status = 200, body = Vec<QueryTx>),
    )
)]
pub async fn query(
    State(state): State<AppState>,
    user: User,
) -> Result<impl IntoResponse, ApiError> {
    let res = services::transactions::query(&state.data, &user.id).await?;

    Ok(Json(res))
}
