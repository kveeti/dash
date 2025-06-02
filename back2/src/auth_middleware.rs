use std::convert::Infallible;
use subtle::ConstantTimeEq;

use anyhow::{Context, anyhow};
use axum::{
    RequestPartsExt,
    extract::{FromRef, FromRequestParts, OptionalFromRequestParts, Request},
    middleware::Next,
    response::Response,
};
use axum_extra::{TypedHeader, headers, typed_header::TypedHeaderRejectionReason};
use http::{HeaderMap, Method, request::Parts};
use hyper::header;

use crate::{
    endpoints::auth::{COOKIE_AUTH, verify_token},
    error::ApiError,
    state::AppState,
};

#[derive(Debug)]
pub struct LoggedInUser {
    pub id: String,
}

impl<S> FromRequestParts<S> for LoggedInUser
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let state = AppState::from_ref(state);

        let cookies = parts
            .extract::<TypedHeader<headers::Cookie>>()
            .await
            .map_err(|e| match *e.name() {
                header::COOKIE => match e.reason() {
                    TypedHeaderRejectionReason::Missing => {
                        ApiError::NoAuth("no cookies".to_owned())
                    }
                    _ => ApiError::UnexpectedError(anyhow!("error getting cookies")),
                },
                _ => ApiError::UnexpectedError(anyhow!("error getting cookies")),
            })?;

        let auth_cookie = cookies
            .get(COOKIE_AUTH)
            .ok_or(ApiError::NoAuth("no cookie".to_owned()))?;

        let auth_token = verify_token(&state.config.secret, auth_cookie)
            .map_err(|_err| ApiError::NoAuth("invalid token".to_owned()))?;

        let session = state
            .data
            .get_session(&auth_token.user_id, &auth_token.session_id)
            .await
            .context("error getting session")?
            .ok_or(ApiError::NoAuth("no session".to_string()))?;

        return Ok(LoggedInUser {
            id: session.user_id.to_owned(),
        });
    }
}

impl<S> OptionalFromRequestParts<S> for LoggedInUser
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &S,
    ) -> Result<Option<Self>, Self::Rejection> {
        match <LoggedInUser as FromRequestParts<S>>::from_request_parts(parts, state).await {
            Ok(res) => Ok(Some(res)),
            Err(_) => Ok(None),
        }
    }
}

pub async fn csrf_middleware(
    TypedHeader(cookies): TypedHeader<headers::Cookie>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    if request.method() != Method::GET {
        let csrf_header = headers
            .get("x-csrf")
            .ok_or(ApiError::NoAccess("csrf".to_string()))?;
        let csrf_cookie = cookies
            .get("csrf")
            .ok_or(ApiError::NoAccess("csrf".to_string()))?;

        let matches: bool = csrf_header.as_bytes().ct_eq(csrf_cookie.as_bytes()).into();
        if !matches {
            return Err(ApiError::NoAccess("csrf".to_string()));
        }
    }

    Ok(next.run(request).await)
}
