use anyhow::Context;
use axum::{Json, extract::State, response::IntoResponse};
use serde::{Deserialize, Serialize};
use serde_with::{NoneAsEmptyString, serde_as};
use utoipa::ToSchema;

use crate::{
    auth_middleware::LoggedInUser,
    data::{QueryTx, QueryTxInput, QueryTxInputCursor},
    error::ApiError,
    state::AppState,
};

#[serde_as]
#[derive(Deserialize, ToSchema, Debug)]
pub struct TransactionsQueryInput {
    #[serde_as(as = "NoneAsEmptyString")]
    pub search_text: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    pub left: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    pub right: Option<String>,
    pub limit: Option<i8>,
}

#[derive(Serialize, ToSchema, Debug)]
pub struct TransactionsQueryOutput {
    pub transactions: Vec<QueryTx>,
    pub next_id: Option<String>,
    pub prev_id: Option<String>,
}

#[utoipa::path(
    post,
    path = "/v1/transactions/query",
    operation_id = "v1/transactions/query",
    request_body(
        content = TransactionsQueryInput,
        content_type = "application/json",
    ),
    responses(
        (status = 200, body = TransactionsQueryOutput),
    )
)]
#[tracing::instrument(skip(state))]
pub async fn query(
    State(state): State<AppState>,
    user: LoggedInUser,
    Json(input): Json<TransactionsQueryInput>,
) -> Result<impl IntoResponse, ApiError> {
    let mut input2 = QueryTxInput {
        cursor: None,
        limit: None,
        search_text: None,
    };

    if let Some(search_text) = input.search_text {
        input2.search_text = Some(search_text);
    }

    if let Some(limit) = input.limit {
        input2.limit = Some(limit);
    }

    if input.left.is_some() && input.right.is_some() {
        return Err(ApiError::BadRequest("left or right".to_string()));
    }

    if let Some(left) = input.left {
        input2.cursor = Some(QueryTxInputCursor::Left(left));
    } else if let Some(right) = input.right {
        input2.cursor = Some(QueryTxInputCursor::Right(right));
    }

    let res = state
        .data
        .query_transactions(&user.id, input2)
        .await
        .context("error querying transactions")?;

    Ok(Json(res))
}
