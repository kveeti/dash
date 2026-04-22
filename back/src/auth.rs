use axum_extra::extract::CookieJar;

use crate::{error::ApiError, state::AppState};

pub const AUTH_SESSION_COOKIE: &str = "sync_session_id";

pub async fn require_user_id(state: &AppState, jar: &CookieJar) -> Result<String, ApiError> {
    if let Some(cookie) = jar.get(AUTH_SESSION_COOKIE) {
        let session_id = cookie.value();
        if let Some(user_id) = state.db.resolve_session_user_id(session_id).await? {
            return Ok(user_id);
        }
    }

    Err(ApiError::Unauthorized)
}
