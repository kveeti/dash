use std::collections::HashMap;

use axum::{
    extract::{self, Path, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use http::StatusCode;
use serde::Deserialize;
use serde_with::{NoneAsEmptyString, serde_as};

use crate::{
    auth_middleware::LoggedInUser,
    data::UpdateTx,
    error::{ApiError, ErrorDetails},
    state::AppState,
};

#[serde_as]
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct TransactionUpdateInput {
    pub counter_party: String,
    pub date: DateTime<Utc>,
    pub amount: f32,
    #[serde_as(as = "NoneAsEmptyString")]
    pub additional: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    pub category: Option<String>,
    pub account: Option<String>,
}

#[cfg_attr(feature = "docs", utoipa::path(
    patch,
    path = "/v1/transactions/{id}",
    operation_id = "v1/transactions/update",
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
))]
#[tracing::instrument(skip(state))]
pub async fn update(
    State(state): State<AppState>,
    user: LoggedInUser,
    Path(id): Path<String>,
    extract::Json(payload): extract::Json<TransactionUpdateInput>,
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

    let tx = UpdateTx {
        counter_party: &payload.counter_party,
        additional: payload.additional.as_deref(),
        amount: payload.amount,
        currency: &"EUR".to_string(),
        date: payload.date,
    };

    state
        .data
        .update_tx_2(&user.id, &id, &tx, account, payload.category)
        .await?;

    return Ok(StatusCode::OK);
}
