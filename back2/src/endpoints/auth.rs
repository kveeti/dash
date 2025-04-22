use anyhow::Context;
use axum::{
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

const AUTH_STATE: &str = "auth_state";

#[utoipa::path(
    get,
    path = "/auth/init",
    responses(
        (status = 307)
    )
)]
pub async fn init(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    let (url, state_str) = services::auth::init(&state.config)?;

    let state_cookie = CookieBuilder::new(AUTH_STATE, state_str)
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
        .get(AUTH_STATE)
        .ok_or(ApiError::BadRequest("no state".to_owned()))?;

    let auth_token = services::auth::callback(
        &state.config,
        &data,
        &query.code,
        &query.state,
        stored_state,
    )
    .await?;

    let empty_state_cookie = create_empty_state_cookie(state.config.use_secure_cookies);

    let auth_cookie = create_auth_cookie(state.config.use_secure_cookies, &auth_token);

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

    return Ok((headers, Redirect::temporary(&state.config.front_base_url)));
}

#[cfg(debug_assertions)]
#[utoipa::path(
    get,
    path = "/auth/___DEV_LOGIN___",
    responses(
        (status = 200)
    )
)]
pub async fn ___dev_login___(
    State(state): State<AppState>,
    State(data): State<Data>,
) -> Result<impl IntoResponse, ApiError> {
    let auth_token = services::auth::___dev_login___(&state.config, &data).await?;

    let empty_state_cookie = create_empty_state_cookie(state.config.use_secure_cookies);

    let auth_cookie = create_auth_cookie(state.config.use_secure_cookies, &auth_token);

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

    return Ok((headers, Redirect::temporary(&state.config.front_base_url)));
}

fn create_auth_cookie(is_secure: bool, auth_token: &str) -> String {
    CookieBuilder::new("auth", auth_token)
        .secure(is_secure)
        .same_site(cookie::SameSite::Lax)
        .http_only(true)
        .path("/")
        .expires(cookie::Expiration::from(
            OffsetDateTime::now_utc().saturating_add(Duration::days(7)),
        ))
        .build()
        .to_string()
}

fn create_empty_state_cookie(is_secure: bool) -> String {
    CookieBuilder::new("state", "")
        .secure(is_secure)
        .same_site(cookie::SameSite::Lax)
        .http_only(true)
        .expires(cookie::Expiration::from(
            OffsetDateTime::from_unix_timestamp(0).expect("epoch"),
        ))
        .build()
        .to_string()
}
