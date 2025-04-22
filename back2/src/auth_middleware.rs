use std::convert::Infallible;

use anyhow::{Context, anyhow};
use axum::{
    RequestPartsExt,
    extract::{FromRef, FromRequestParts, OptionalFromRequestParts},
};
use axum_extra::{TypedHeader, headers, typed_header::TypedHeaderRejectionReason};
use http::request::Parts;
use hyper::header;

use crate::{error::ApiError, services::auth::verify_token, state::AppState};

#[derive(Debug)]
pub struct User {
    pub id: String,
}

impl<S> FromRequestParts<S> for User
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
            .get("auth")
            .ok_or(ApiError::NoAuth("no cookie".to_owned()))?;

        let auth_token =
            verify_token(&state.config.secret, auth_cookie).context("error verifying token")?;

        let session = state
            .data
            .sessions
            .get_one(&auth_token.user_id, &auth_token.session_id)
            .await
            .context("error getting session")?
            .ok_or(ApiError::NoAuth("no session".to_string()))?;

        return Ok(User {
            id: session.user_id.to_owned(),
        });
    }
}

impl<S> OptionalFromRequestParts<S> for User
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &S,
    ) -> Result<Option<Self>, Self::Rejection> {
        match <User as FromRequestParts<S>>::from_request_parts(parts, state).await {
            Ok(res) => Ok(Some(res)),
            Err(_) => Ok(None),
        }
    }
}
