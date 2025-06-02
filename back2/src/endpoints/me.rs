use axum::{Json, extract::State, response::IntoResponse};
use cookie::CookieBuilder;
use http::{HeaderMap, header};
use openidconnect::CsrfToken;
use serde::Serialize;
use utoipa::ToSchema;

use crate::{auth_middleware::LoggedInUser, data::Settings, error::ApiError, state::AppState};

#[derive(Serialize, ToSchema)]
pub struct MeOutput {
    pub id: String,
    pub settings: Option<Settings>,
    pub csrf: String,
}

#[utoipa::path(
    get,
    path = "/v1/@me",
    responses(
        (status = 200, body = MeOutput)
    )
)]
pub async fn get_me(
    State(state): State<AppState>,
    user: LoggedInUser,
) -> Result<impl IntoResponse, ApiError> {
    let settings = state.data.get_settings(&user.id).await?;

    let csrf = CsrfToken::new_random().secret().to_string();

    let mut headers = HeaderMap::new();
    headers.append(
        header::SET_COOKIE,
        CookieBuilder::new("csrf", csrf.to_owned())
            .http_only(true)
            .expires(cookie::Expiration::Session)
            .path("/api")
            .same_site(cookie::SameSite::Strict)
            .secure(state.config.use_secure_cookies)
            .build()
            .to_string()
            .parse()
            .expect("csrf cookie"),
    );

    return Ok((
        headers,
        Json(MeOutput {
            id: user.id.to_owned(),
            settings,
            csrf,
        }),
    ));
}
