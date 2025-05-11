use axum::{
    extract::{self, Path, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use http::StatusCode;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{auth_middleware::User, data::UpdateTx, error::ApiError, state::AppState};

#[derive(Deserialize, ToSchema)]
pub struct TransactionUpdateInput {
    pub counter_party: String,
    pub date: DateTime<Utc>,
    pub amount: f32,
    pub additional: Option<String>,
    pub currency: String,
    pub category_name: Option<String>,
}

#[utoipa::path(
    patch,
    path = "/transactions/{id}",
    operation_id = "transactions/update",
    params(
        ("id" = String, description = "Transaction ID"),
    ),
    request_body(
        content = TransactionUpdateInput,
        content_type = "application/json",
    ),
    responses(
        (status = 204, body = ())
    )
)]
pub async fn update(
    State(state): State<AppState>,
    user: User,
    Path(id): Path<String>,
    extract::Json(input): extract::Json<TransactionUpdateInput>,
) -> Result<impl IntoResponse, ApiError> {
    let tx = UpdateTx {
        counter_party: &input.counter_party,
        additional: input.additional.as_deref(),
        amount: input.amount,
        currency: &input.currency,
        date: input.date,
    };

    if let Some(category_name) = input.category_name {
        state
            .data
            .update_tx_with_category(&user.id, &id, &tx, &category_name)
            .await?;
    } else {
        state.data.update_tx(&user.id, &id, &tx).await?;
    }

    return Ok(StatusCode::OK);
}
