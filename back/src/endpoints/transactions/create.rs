use std::collections::HashMap;

use axum::{
    extract::{self, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use http::StatusCode;
use serde::Deserialize;
use serde_with::{NoneAsEmptyString, serde_as};

use crate::{
    auth_middleware::LoggedInUser,
    data::{InsertTx, create_id},
    error::{ApiError, ErrorDetails},
    state::AppState,
};

#[serde_as]
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct CreateTransactionInput {
    pub counter_party: String,
    pub date: DateTime<Utc>,
    pub categorize_on: Option<DateTime<Utc>>,
    pub amount: f32,
    #[serde_as(as = "NoneAsEmptyString")]
    pub additional: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    pub notes: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    pub category_id: Option<String>,
    pub account_id: String,
}

#[cfg_attr(feature = "docs", utoipa::path(
    post,
    path = "/v1/transactions",
    operation_id = "v1/transactions/create",
    request_body(
        content = CreateTransactionInput,
        content_type = "application/json",
    ),
    responses(
        (status = 201, body = ())
    )
))]
#[tracing::instrument(skip(state))]
pub async fn create(
    State(state): State<AppState>,
    user: LoggedInUser,
    extract::Json(payload): extract::Json<CreateTransactionInput>,
) -> Result<impl IntoResponse, ApiError> {
    let mut errors: HashMap<String, String> = HashMap::new();

    let counter_party = payload.counter_party.trim();
    if counter_party.is_empty() {
        errors.insert("counter_party".to_owned(), "required".to_owned());
    } else if counter_party.len() > 250 {
        errors.insert(
            "counter_party".to_owned(),
            "must be shorter than 250".to_owned(),
        );
    }

    if !errors.is_empty() {
        return Err(ApiError::BadRequestDetails(
            "invalid request".to_owned(),
            ErrorDetails(errors),
        ));
    }

    let tx = InsertTx {
        id: create_id(),
        date: payload.date,
        categorize_on: payload.categorize_on,
        counter_party: counter_party.to_owned(),
        additional: payload.additional,
        notes: payload.notes,
        amount: payload.amount,
        currency: "EUR".to_owned(),
    };

    state
        .data
        .insert_tx(&user.id, &tx, payload.account_id, payload.category_id)
        .await?;

    return Ok(StatusCode::CREATED);
}
