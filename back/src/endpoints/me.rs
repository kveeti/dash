use crate::{auth_middleware::LoggedInUser, data::UserSettings, error::ApiError, state::AppState};
use axum::{Json, extract::State, response::IntoResponse};
use cookie::CookieBuilder;
use http::{HeaderMap, header};
use openidconnect::CsrfToken;
use serde::Serialize;

#[derive(Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub struct MeOutput {
    pub id: String,
    pub settings: Option<UserSettings>,
    pub csrf: String,
}

#[cfg_attr(feature = "docs", utoipa::path(
    get,
    path = "/v1/@me",
    responses(
        (status = 200, body = MeOutput)
    )
))]
#[tracing::instrument(skip(state))]
pub async fn get_me(
    State(state): State<AppState>,
    user: LoggedInUser,
) -> Result<impl IntoResponse, ApiError> {
    let settings = state.data.get_settings(&user.id).await?;

    let csrf = CsrfToken::new_random().secret().to_string();

    let mut headers = HeaderMap::new();
    headers.insert(
        header::SET_COOKIE,
        CookieBuilder::new("csrf", csrf.to_owned())
            .http_only(true)
            .expires(cookie::Expiration::Session)
            .path("/")
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
