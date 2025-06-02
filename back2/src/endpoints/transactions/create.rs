use std::collections::HashMap;

use axum::{
    extract::{self, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use http::StatusCode;
use serde::Deserialize;
use serde_with::{NoneAsEmptyString, serde_as};
use utoipa::ToSchema;

use crate::{
    auth_middleware::LoggedInUser,
    data::{InsertTx, create_id},
    error::{ApiError, ErrorDetails},
    state::AppState,
};

#[serde_as]
#[derive(Deserialize, ToSchema)]
pub struct CreateTransactionInput {
    pub counter_party: String,
    pub date: DateTime<Utc>,
    pub amount: f32,
    #[serde_as(as = "NoneAsEmptyString")]
    pub additional: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    pub category: Option<String>,
    pub account: Option<String>,
}

#[utoipa::path(
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
)]
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

    let account = match payload.account {
        Some(ref acc) => {
            let account = acc.trim();
            if account.is_empty() {
                errors.insert("account".to_owned(), "required".to_owned());
                None
            } else if account.len() > 250 {
                errors.insert("account".to_owned(), "must be shorter than 250".to_owned());
                None
            } else {
                Some(account.to_owned())
            }
        }
        None => {
            errors.insert("account".to_owned(), "required".to_owned());
            None
        }
    };

    if !errors.is_empty() {
        return Err(ApiError::BadRequestDetails(
            "invalid request".to_owned(),
            ErrorDetails(errors),
        ));
    }

    let account = account.unwrap();

    let tx = InsertTx {
        id: create_id(),
        counter_party: counter_party.to_owned(),
        og_counter_party: payload.counter_party,
        additional: payload.additional,
        amount: payload.amount,
        currency: "EUR".to_owned(),
        date: payload.date,
    };

    state
        .data
        .insert_tx(&user.id, &tx, account, payload.category)
        .await?;

    return Ok(StatusCode::CREATED);
}
