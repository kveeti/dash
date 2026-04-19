use std::sync::Arc;

use anyhow::Context;
use axum::{
    Json, Router,
    extract::{Query, State},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use axum_extra::extract::{CookieJar, cookie::Cookie};
use base64::Engine;
use hex::{decode as hex_decode, encode as hex_encode};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::{config::OidcConfig, error::ApiError, state::AppState};

pub const AUTH_COOKIE: &str = "auth";
const AUTH_CODE_VERIFIER_COOKIE: &str = "auth_code_verifier";
const AUTH_STATE_COOKIE: &str = "auth_state";
const SESSION_TTL_DAYS: i64 = 30;

type HmacSha256 = Hmac<Sha256>;

/// Discovered OIDC endpoints. Populated lazily on first use.
#[derive(Clone, Debug)]
pub struct OidcEndpoints {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub userinfo_endpoint: String,
}

#[derive(Clone)]
pub struct OidcState {
    pub config: Arc<OidcConfig>,
    pub endpoints: Arc<RwLock<Option<OidcEndpoints>>>,
    pub http: reqwest::Client,
}

impl OidcState {
    pub fn new(config: OidcConfig) -> Self {
        Self {
            config: Arc::new(config),
            endpoints: Arc::new(RwLock::new(None)),
            http: reqwest::Client::new(),
        }
    }

    pub async fn endpoints(&self) -> Result<OidcEndpoints, anyhow::Error> {
        if let Some(existing) = self.endpoints.read().await.clone() {
            return Ok(existing);
        }
        let mut slot = self.endpoints.write().await;
        if let Some(existing) = slot.clone() {
            return Ok(existing);
        }
        let discovered = discover(&self.http, &self.config.url).await?;
        *slot = Some(discovered.clone());
        Ok(discovered)
    }
}

#[derive(Deserialize)]
struct DiscoveryDoc {
    authorization_endpoint: String,
    token_endpoint: String,
    userinfo_endpoint: String,
}

async fn discover(http: &reqwest::Client, issuer: &str) -> Result<OidcEndpoints, anyhow::Error> {
    let url = issuer.trim_end_matches("/");
    info!("discovering oidc at {url}");
    let doc: DiscoveryDoc = http
        .get(url)
        .send()
        .await
        .context("oidc discovery request failed")?
        .error_for_status()
        .context("oidc discovery non-2xx")?
        .json()
        .await
        .context("oidc discovery bad json")?;
    Ok(OidcEndpoints {
        authorization_endpoint: doc.authorization_endpoint,
        token_endpoint: doc.token_endpoint,
        userinfo_endpoint: doc.userinfo_endpoint,
    })
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/init", get(init))
        .route("/auth/callback", get(callback))
        .route("/auth/@me", get(me))
        .route("/auth/logout", get(logout))
        .route("/handshake", post(handshake))
}

fn short_lived_cookie<'a>(name: &'a str, value: String, secure: bool) -> Cookie<'a> {
    Cookie::build((name.to_string(), value))
        .http_only(true)
        .same_site(axum_extra::extract::cookie::SameSite::Lax)
        .secure(secure)
        .path("/")
        .expires(time::OffsetDateTime::now_utc() + time::Duration::minutes(5))
        .build()
}

fn session_cookie<'a>(name: &'a str, value: String, secure: bool) -> Cookie<'a> {
    Cookie::build((name.to_string(), value))
        .http_only(true)
        .same_site(axum_extra::extract::cookie::SameSite::Lax)
        .secure(secure)
        .path("/")
        .expires(time::OffsetDateTime::now_utc() + time::Duration::days(SESSION_TTL_DAYS))
        .build()
}

fn remove_cookie<'a>(name: &'a str) -> Cookie<'a> {
    Cookie::build((name.to_string(), ""))
        .http_only(true)
        .path("/")
        .expires(time::OffsetDateTime::UNIX_EPOCH)
        .build()
}

fn random_b64url(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&buf)
}

fn random_b64(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::STANDARD.encode(&buf)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&digest)
}

fn parse_session_token(token: &str) -> Option<(&str, &str, &str)> {
    let mut parts = token.split(':');
    let user_id = parts.next()?;
    let session_id = parts.next()?;
    let sig = parts.next()?;
    if parts.next().is_some() || user_id.is_empty() || session_id.is_empty() || sig.is_empty() {
        return None;
    }
    Some((user_id, session_id, sig))
}

fn sign_session_payload(payload: &str, secret: &[u8]) -> Result<String, ApiError> {
    let mut mac = HmacSha256::new_from_slice(secret)
        .map_err(|e| ApiError::UnexpectedError(anyhow::anyhow!("invalid session secret: {e}")))?;
    mac.update(payload.as_bytes());
    Ok(hex_encode(mac.finalize().into_bytes()))
}

fn verify_session_token(token: &str, secret: &[u8]) -> Result<(String, String), ApiError> {
    let (user_id, session_id, sig_hex) =
        parse_session_token(token).ok_or(ApiError::Unauthorized)?;
    let payload = format!("{user_id}:{session_id}");
    let sig = hex_decode(sig_hex).map_err(|_| ApiError::Unauthorized)?;

    let mut mac = HmacSha256::new_from_slice(secret)
        .map_err(|e| ApiError::UnexpectedError(anyhow::anyhow!("invalid session secret: {e}")))?;
    mac.update(payload.as_bytes());
    mac.verify_slice(&sig).map_err(|_| ApiError::Unauthorized)?;

    Ok((user_id.to_string(), session_id.to_string()))
}

fn create_session_token(
    user_id: &str,
    session_id: &str,
    secret: &[u8],
) -> Result<String, ApiError> {
    let payload = format!("{user_id}:{session_id}");
    let sig = sign_session_payload(&payload, secret)?;
    Ok(format!("{payload}:{sig}"))
}

async fn init(State(state): State<AppState>, jar: CookieJar) -> Result<Response, ApiError> {
    let oidc = state
        .oidc
        .as_ref()
        .ok_or_else(|| ApiError::BadRequest("oidc not configured".into()))?;

    let endpoints = oidc.endpoints().await.map_err(ApiError::UnexpectedError)?;

    let verifier = random_b64url(32);
    let challenge = pkce_challenge(&verifier);
    let csrf_state = random_b64url(16);

    let secure = oidc.config.redirect_url.starts_with("https://");

    let auth_url = {
        let mut url = url::Url::parse(&endpoints.authorization_endpoint)
            .map_err(|e| ApiError::UnexpectedError(anyhow::anyhow!(e)))?;
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &oidc.config.client_id)
            .append_pair("redirect_uri", &oidc.config.redirect_url)
            .append_pair("scope", "openid")
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &csrf_state);
        url.to_string()
    };

    let jar = jar
        .add(short_lived_cookie(
            AUTH_CODE_VERIFIER_COOKIE,
            verifier,
            secure,
        ))
        .add(short_lived_cookie(AUTH_STATE_COOKIE, csrf_state, secure));

    Ok((jar, Redirect::temporary(&auth_url)).into_response())
}

#[derive(Deserialize)]
struct CallbackParams {
    code: String,
    state: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct UserInfo {
    sub: String,
}

async fn callback(
    State(state): State<AppState>,
    Query(params): Query<CallbackParams>,
    jar: CookieJar,
) -> Result<Response, ApiError> {
    let oidc = state
        .oidc
        .as_ref()
        .ok_or_else(|| ApiError::BadRequest("oidc not configured".into()))?;

    let verifier = jar
        .get(AUTH_CODE_VERIFIER_COOKIE)
        .map(|c| c.value().to_string())
        .ok_or_else(|| ApiError::BadRequest("missing code verifier".into()))?;

    let expected_state = jar.get(AUTH_STATE_COOKIE).map(|c| c.value().to_string());
    if let (Some(expected), Some(got)) = (expected_state.as_ref(), params.state.as_ref()) {
        if expected != got {
            return Err(ApiError::BadRequest("state mismatch".into()));
        }
    }

    let endpoints = oidc.endpoints().await.map_err(ApiError::UnexpectedError)?;

    let token_resp: TokenResponse = oidc
        .http
        .post(&endpoints.token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", params.code.as_str()),
            ("redirect_uri", oidc.config.redirect_url.as_str()),
            ("client_id", oidc.config.client_id.as_str()),
            ("client_secret", oidc.config.client_secret.as_str()),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .context("token exchange failed")
        .map_err(ApiError::UnexpectedError)?
        .error_for_status()
        .context("token exchange non-2xx")
        .map_err(ApiError::UnexpectedError)?
        .json()
        .await
        .context("token exchange bad json")
        .map_err(ApiError::UnexpectedError)?;

    let userinfo: UserInfo = oidc
        .http
        .get(&endpoints.userinfo_endpoint)
        .bearer_auth(&token_resp.access_token)
        .send()
        .await
        .context("userinfo fetch failed")
        .map_err(ApiError::UnexpectedError)?
        .error_for_status()
        .context("userinfo non-2xx")
        .map_err(ApiError::UnexpectedError)?
        .json()
        .await
        .context("userinfo bad json")
        .map_err(ApiError::UnexpectedError)?;

    let new_salt = random_b64(16);
    let user_id = state
        .db
        .upsert_user_with_salt(&userinfo.sub, &new_salt)
        .await?;
    let session_id = state.db.create_session(&user_id, SESSION_TTL_DAYS).await?;
    let auth_token = create_session_token(&user_id, &session_id, &state.session_secret)?;

    let secure = oidc.config.redirect_url.starts_with("https://");
    let jar = jar
        .add(session_cookie(AUTH_COOKIE, auth_token, secure))
        .remove(remove_cookie(AUTH_CODE_VERIFIER_COOKIE))
        .remove(remove_cookie(AUTH_STATE_COOKIE));

    Ok((jar, Redirect::temporary(&format!("{}/", state.base_url))).into_response())
}

#[derive(Serialize)]
struct MeResponse {
    salt: String,
}

async fn me(State(state): State<AppState>, jar: CookieJar) -> Result<Response, ApiError> {
    let user_id = require_user_id(&state, &jar).await?;
    let salt = state.db.get_user_salt(&user_id).await?;
    let Some(salt) = salt else {
        return Err(ApiError::Unauthorized);
    };
    Ok(Json(MeResponse { salt }).into_response())
}

async fn logout(State(state): State<AppState>, jar: CookieJar) -> Result<Response, ApiError> {
    if let Some(raw) = jar.get(AUTH_COOKIE).map(|c| c.value().to_string()) {
        if let Ok((user_id, session_id)) = verify_session_token(&raw, &state.session_secret) {
            if let Err(err) = state.db.delete_session(&user_id, &session_id).await {
                warn!("failed to delete session during logout: {err:#}");
            }
        }
    }

    let jar = jar.remove(remove_cookie(AUTH_COOKIE));
    Ok((
        jar,
        Redirect::temporary(&format!("{}/settings", state.base_url)),
    )
        .into_response())
}

#[derive(Serialize)]
struct HandshakeResponse {
    user_id: String,
    salt: String,
}

/// POST /handshake — returns {user_id, salt} for the logged-in user so the client
/// can derive its encryption key. If no auth cookie is present, 401.
async fn handshake(State(state): State<AppState>, jar: CookieJar) -> Result<Response, ApiError> {
    let user_id = require_user_id(&state, &jar).await?;

    let salt = state.db.get_user_salt(&user_id).await?;
    let Some(salt) = salt else {
        return Err(ApiError::Unauthorized);
    };

    Ok(Json(HandshakeResponse { user_id, salt }).into_response())
}

/// Resolve authenticated user id from cookie, verify token signature,
/// ensure session is present+unexpired in DB, and apply sliding expiration.
pub async fn require_user_id(state: &AppState, jar: &CookieJar) -> Result<String, ApiError> {
    let token = jar
        .get(AUTH_COOKIE)
        .map(|c| c.value().to_string())
        .ok_or(ApiError::Unauthorized)?;

    let (user_id, session_id) = verify_session_token(&token, &state.session_secret)?;
    let touched = state
        .db
        .touch_session(&user_id, &session_id, SESSION_TTL_DAYS)
        .await?;
    if !touched {
        return Err(ApiError::Unauthorized);
    }

    Ok(user_id)
}
