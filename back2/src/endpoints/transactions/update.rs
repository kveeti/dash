use axum::{
    extract::{self, Path, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use http::StatusCode;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{
    auth_middleware::User,
    data::{IdentifierSpec, UpdateTx},
    error::ApiError,
    state::AppState,
};

#[derive(Deserialize, ToSchema)]
pub struct TransactionUpdateInput {
    pub counter_party: String,
    pub date: DateTime<Utc>,
    pub amount: f32,
    pub additional: Option<String>,
    pub currency: String,
    pub category_name: Option<String>,
    pub category_id: Option<String>,
    pub account_name: Option<String>,
    pub account_id: Option<String>,
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

    let cat = match (input.category_name, input.category_id) {
        (Some(_), Some(_)) => Err(ApiError::BadRequest(
            "category_id OR category_name".to_string(),
        ))?,
        (Some(name), None) => Some(IdentifierSpec::Name(name.to_owned())),
        (None, Some(id)) => Some(IdentifierSpec::Id(id.to_owned())),
        _ => None,
    };

    let acc = match (input.account_name, input.account_id) {
        (Some(_), Some(_)) => Err(ApiError::BadRequest(
            "account_id OR account_name".to_string(),
        ))?,
        (Some(name), None) => Some(IdentifierSpec::Name(name.to_owned())),
        (None, Some(id)) => Some(IdentifierSpec::Id(id.to_owned())),
        _ => None,
    };

    state.data.update_tx_2(&user.id, &id, &tx, acc, cat).await?;

    return Ok(StatusCode::OK);
}
