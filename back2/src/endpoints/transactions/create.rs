use axum::{
    extract::{self, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use http::StatusCode;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{
    auth_middleware::User,
    data::{IdentifierSpec, InsertTx, create_id},
    error::ApiError,
    state::AppState,
};

#[derive(Deserialize, ToSchema)]
pub struct CreateTransactionInput {
    pub counter_party: String,
    pub date: DateTime<Utc>,
    pub amount: f32,
    pub additional: Option<String>,
    pub category_name: Option<String>,
    pub category_id: Option<String>,
    pub account_name: Option<String>,
    pub account_id: Option<String>,
}

#[utoipa::path(
    post,
    path = "/transactions",
    operation_id = "transactions/create",
    request_body(
        content = CreateTransactionInput,
        content_type = "application/json",
    ),
    responses(
        (status = 201, body = ())
    )
)]
pub async fn create(
    State(state): State<AppState>,
    user: User,
    extract::Json(input): extract::Json<CreateTransactionInput>,
) -> Result<impl IntoResponse, ApiError> {
    let tx = InsertTx {
        id: create_id(),
        counter_party: input.counter_party.to_owned(),
        og_counter_party: input.counter_party,
        additional: input.additional,
        amount: input.amount,
        currency: "EUR".to_owned(),
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

    state.data.insert_tx(&user.id, &tx, acc, cat).await?;

    return Ok(StatusCode::CREATED);
}
