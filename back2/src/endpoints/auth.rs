use anyhow::Context;
use axum::{
    debug_handler,
    extract::{Query, State},
    response::{IntoResponse, Redirect},
};
use axum_extra::{TypedHeader, headers};
use cookie::{
    CookieBuilder,
    time::{Duration, OffsetDateTime},
};
use hyper::{HeaderMap, header};
use serde::Deserialize;
use utoipa::IntoParams;

use crate::{data::Data, error::ApiError, services, state::AppState};

#[utoipa::path(
    get,
    path = "/auth/init",
    responses(
        (status = 307)
    )
)]
#[debug_handler]
pub async fn init(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    let (url, state_str) = services::auth::init(&state.config)?;

    let state_cookie = CookieBuilder::new("auth_state", state_str)
        .secure(state.config.use_secure_cookies)
        .same_site(cookie::SameSite::Lax)
        .http_only(true)
        .expires(cookie::Expiration::from(
            OffsetDateTime::now_utc().saturating_add(Duration::minutes(5)),
        ))
        .build()
        .to_string();

    let mut headers = HeaderMap::new();
    headers.insert(
        header::SET_COOKIE,
        state_cookie.parse().context("error parsing cookie")?,
    );

    return Ok((headers, Redirect::temporary(&url)));
}

#[derive(IntoParams, Deserialize)]
pub struct AuthCallbackQuery {
    pub code: String,
    pub state: String,
}

#[utoipa::path(
    get,
    path = "/auth/callback",
    params(
        AuthCallbackQuery
    ),
    responses(
        (status = 200)
    )
)]
pub async fn callback(
    State(state): State<AppState>,
    Query(query): Query<AuthCallbackQuery>,
    TypedHeader(cookies): TypedHeader<headers::Cookie>,
    State(data): State<Data>,
) -> Result<impl IntoResponse, ApiError> {
    let stored_state = cookies
        .get("auth_state")
        .ok_or(ApiError::BadRequest("no state".to_owned()))?;

    let auth_token = services::auth::callback(
        &state.config,
        &data,
        &query.code,
        &query.state,
        stored_state,
    )
    .await?;

    let empty_state_cookie = CookieBuilder::new("state", "")
        .secure(state.config.use_secure_cookies)
        .same_site(cookie::SameSite::Lax)
        .http_only(true)
        .expires(cookie::Expiration::from(
            OffsetDateTime::from_unix_timestamp(0).expect("epoch"),
        ))
        .build()
        .to_string();

    let auth_cookie = CookieBuilder::new("auth", auth_token)
        .secure(state.config.use_secure_cookies)
        .same_site(cookie::SameSite::Lax)
        .http_only(true)
        .path("/")
        .expires(cookie::Expiration::from(
            OffsetDateTime::now_utc().saturating_add(Duration::days(7)),
        ))
        .build()
        .to_string();

    let mut headers = HeaderMap::new();
    headers.insert(
        header::SET_COOKIE,
        empty_state_cookie
            .parse()
            .context("error parsing state cookie")?,
    );
    headers.insert(
        header::SET_COOKIE,
        auth_cookie.parse().context("error parsing auth cookie")?,
    );

    return Ok((headers, Redirect::temporary("http://localhost:3000")));
}
