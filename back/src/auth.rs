use axum_extra::extract::{
    CookieJar,
    cookie::{Cookie, SameSite},
};
use time::Duration;

use crate::{error::ApiError, session::hash_session_token, state::AppState};

pub const AUTH_SESSION_COOKIE: &str = "sync_session_id";

pub struct AuthenticatedSession {
    pub jar: CookieJar,
    pub user_id: String,
}

pub fn auth_session_cookie(token: String, secure: bool, ttl_days: i64) -> Cookie<'static> {
    let mut cookie = Cookie::new(AUTH_SESSION_COOKIE, token);
    cookie.set_http_only(true);
    cookie.set_same_site(SameSite::Lax);
    cookie.set_secure(secure);
    cookie.set_path("/");
    cookie.set_max_age(Duration::days(ttl_days));
    cookie
}

pub async fn require_user_id(
    state: &AppState,
    jar: CookieJar,
) -> Result<AuthenticatedSession, ApiError> {
    let Some(cookie) = jar.get(AUTH_SESSION_COOKIE) else {
        return Err(ApiError::Unauthorized);
    };

    let token = cookie.value().to_string();
    let token_hash = hash_session_token(&state.session_secret, &token);
    let Some(user_id) = state
        .db
        .touch_session(&token_hash, state.session_ttl_days)
        .await?
    else {
        return Err(ApiError::Unauthorized);
    };

    let secure = state.base_url.starts_with("https://");
    let jar = jar.add(auth_session_cookie(token, secure, state.session_ttl_days));

    Ok(AuthenticatedSession { jar, user_id })
}
