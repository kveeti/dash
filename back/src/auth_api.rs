use axum::{
    Json, Router,
    extract::State,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use axum_extra::extract::{
    CookieJar,
    cookie::{Cookie, SameSite},
};
use base64::Engine;
use rand::RngCore;
use ring::{
    digest::{SHA256, digest},
    signature::{ED25519, UnparsedPublicKey},
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{AUTH_SESSION_COOKIE, require_user_id},
    error::ApiError,
    state::AppState,
};

const CHALLENGE_TTL_SECS: i64 = 120;
const MAX_ACTIVE_CHALLENGES: i64 = 10_000;
const MAX_ACTIVE_CHALLENGES_PER_USER: i64 = 10;
const AUTH_ID_CONTEXT: &str = "dash/auth/id/v1";
const AUTH_CHALLENGE_CONTEXT: &str = "dash/auth/challenge/v1";
const AUTH_VERIFY_METHOD: &str = "POST";
const AUTH_VERIFY_PATH: &str = "/api/v1/auth/verify";

#[derive(Debug, Deserialize)]
struct RegisterRequest {
    auth_id: String,
    auth_public_key: String,
}

#[derive(Debug, Deserialize)]
struct ChallengeRequest {
    auth_id: String,
}

#[derive(Debug, Deserialize)]
struct VerifyRequest {
    auth_id: String,
    challenge_id: String,
    signature: String,
}

#[derive(Debug, Serialize)]
struct LoginResponse {}

#[derive(Debug, Serialize)]
struct RegisterResponse {
    registered: bool,
}

#[derive(Debug, Serialize)]
struct MeResponse {
    user_id: String,
}

#[derive(Debug, Serialize)]
struct LogoutResponse {}

#[derive(Debug, Serialize)]
struct ChallengeResponse {
    challenge_id: String,
    nonce: String,
    signature_payload: String,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/challenge", post(challenge))
        .route("/auth/verify", post(verify))
        .route("/auth/logout", post(logout))
        .route("/auth/@me", get(me))
}

fn random_nonce_b64url() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

fn verify_signature(
    auth_public_key_b64url: &str,
    payload: &str,
    signature_b64url: &str,
) -> Result<bool, ApiError> {
    let public_key = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(auth_public_key_b64url.as_bytes())
        .map_err(|_| ApiError::Unauthorized)?;
    let signature = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(signature_b64url.as_bytes())
        .map_err(|_| ApiError::Unauthorized)?;
    let verifier = UnparsedPublicKey::new(&ED25519, public_key);
    Ok(verifier.verify(payload.as_bytes(), &signature).is_ok())
}

fn normalized_base_url(base_url: &str) -> String {
    base_url.trim_end_matches('/').to_string()
}

fn auth_signature_payload(
    base_url: &str,
    auth_id: &str,
    challenge_id: &str,
    nonce: &str,
) -> String {
    format!(
        "{AUTH_CHALLENGE_CONTEXT}\nbase_url:{}\nmethod:{AUTH_VERIFY_METHOD}\npath:{AUTH_VERIFY_PATH}\nauth_id:{auth_id}\nchallenge_id:{challenge_id}\nnonce:{nonce}",
        normalized_base_url(base_url)
    )
}

fn compute_auth_id_from_public_key(public_key: &[u8]) -> String {
    let context_bytes = AUTH_ID_CONTEXT.as_bytes();
    let mut input = Vec::with_capacity(context_bytes.len() + 1 + public_key.len());
    input.extend_from_slice(context_bytes);
    input.push(b':');
    input.extend_from_slice(public_key);
    let id_digest = digest(&SHA256, &input);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(id_digest.as_ref())
}

fn validate_auth_inputs(auth_id: &str, auth_public_key: &str) -> Result<(), ApiError> {
    if auth_id.len() < 32 {
        return Err(ApiError::BadRequest("invalid auth_id".to_string()));
    }
    let provided = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(auth_public_key.as_bytes())
        .map_err(|_| ApiError::BadRequest("invalid auth_public_key".to_string()))?;
    if provided.len() != 32 {
        return Err(ApiError::BadRequest("invalid auth_public_key".to_string()));
    }
    let expected_auth_id = compute_auth_id_from_public_key(&provided);
    if expected_auth_id != auth_id {
        return Err(ApiError::BadRequest(
            "auth_id does not match auth_public_key".to_string(),
        ));
    }
    Ok(())
}

fn validate_stored_auth_binding(auth_id: &str, auth_public_key: &str) -> Result<(), ApiError> {
    let provided = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(auth_public_key.as_bytes())
        .map_err(|_| ApiError::Unauthorized)?;
    if provided.len() != 32 {
        return Err(ApiError::Unauthorized);
    }
    let expected_auth_id = compute_auth_id_from_public_key(&provided);
    if expected_auth_id != auth_id {
        return Err(ApiError::Unauthorized);
    }
    Ok(())
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Response, ApiError> {
    let external_id = body.auth_id.trim();
    let auth_public_key = body.auth_public_key.trim();
    validate_auth_inputs(external_id, auth_public_key)?;

    let existed_before = state
        .db
        .get_user_by_external_id(external_id)
        .await?
        .is_some();
    let user_id = state
        .db
        .upsert_user_with_auth_public_key(external_id, auth_public_key)
        .await?;
    let stored_auth_public_key = state
        .db
        .get_user_auth_public_key(&user_id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    if stored_auth_public_key != auth_public_key {
        return Err(ApiError::Unauthorized);
    }
    validate_stored_auth_binding(external_id, &stored_auth_public_key)?;

    Ok(Json(RegisterResponse {
        registered: !existed_before,
    })
    .into_response())
}

async fn challenge(
    State(state): State<AppState>,
    Json(body): Json<ChallengeRequest>,
) -> Result<Response, ApiError> {
    let auth_id = body.auth_id.trim();
    if auth_id.len() < 32 {
        return Err(ApiError::BadRequest("invalid auth_id".to_string()));
    }

    let Some((user_id, auth_public_key)) = state.db.get_user_by_external_id(auth_id).await? else {
        return Err(ApiError::Unauthorized);
    };
    validate_stored_auth_binding(auth_id, &auth_public_key)?;

    state.db.delete_expired_auth_challenges().await?;
    let active_for_user = state
        .db
        .count_active_auth_challenges_for_user(&user_id)
        .await?;
    if active_for_user >= MAX_ACTIVE_CHALLENGES_PER_USER {
        return Err(ApiError::TooManyRequests(
            "too many active auth challenges".to_string(),
        ));
    }
    let active_total = state.db.count_active_auth_challenges().await?;
    if active_total >= MAX_ACTIVE_CHALLENGES {
        return Err(ApiError::TooManyRequests(
            "auth challenge capacity reached".to_string(),
        ));
    }

    let nonce = random_nonce_b64url();
    let challenge_id = state
        .db
        .create_auth_challenge(&user_id, auth_id, &nonce, CHALLENGE_TTL_SECS)
        .await?;

    Ok(Json(ChallengeResponse {
        signature_payload: auth_signature_payload(&state.base_url, auth_id, &challenge_id, &nonce),
        challenge_id,
        nonce,
    })
    .into_response())
}

async fn verify(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<VerifyRequest>,
) -> Result<Response, ApiError> {
    let auth_id = body.auth_id.trim();
    if auth_id.len() < 32 {
        return Err(ApiError::BadRequest("invalid auth_id".to_string()));
    }

    let Some((user_id, auth_public_key)) = state.db.get_user_by_external_id(auth_id).await? else {
        return Err(ApiError::Unauthorized);
    };
    validate_stored_auth_binding(auth_id, &auth_public_key)?;

    let Some(challenge) = state
        .db
        .consume_auth_challenge(body.challenge_id.trim())
        .await?
    else {
        return Err(ApiError::Unauthorized);
    };

    if challenge.user_id != user_id {
        return Err(ApiError::Unauthorized);
    }
    if challenge.auth_id != auth_id {
        return Err(ApiError::Unauthorized);
    }

    let ok = verify_signature(
        &auth_public_key,
        &auth_signature_payload(
            &state.base_url,
            auth_id,
            body.challenge_id.trim(),
            &challenge.nonce,
        ),
        body.signature.trim(),
    )?;
    if !ok {
        return Err(ApiError::Unauthorized);
    }

    let session_id = state
        .db
        .create_session(&user_id, state.session_ttl_days)
        .await?;
    let secure = state.base_url.starts_with("https://");
    let mut cookie = Cookie::new(AUTH_SESSION_COOKIE, session_id);
    cookie.set_http_only(true);
    cookie.set_same_site(SameSite::Lax);
    cookie.set_secure(secure);
    cookie.set_path("/");

    Ok((jar.add(cookie), Json(LoginResponse {})).into_response())
}

async fn me(State(state): State<AppState>, jar: CookieJar) -> Result<Response, ApiError> {
    let user_id = require_user_id(&state, &jar).await?;
    Ok(Json(MeResponse { user_id }).into_response())
}

async fn logout(State(state): State<AppState>, jar: CookieJar) -> Result<Response, ApiError> {
    if let Some(cookie) = jar.get(AUTH_SESSION_COOKIE) {
        let session_id = cookie.value().to_string();
        if let Some(user_id) = state.db.resolve_session_user_id(&session_id).await? {
            state.db.delete_session(&user_id, &session_id).await?;
        }
    }

    let secure = state.base_url.starts_with("https://");
    let mut cleared = Cookie::new(AUTH_SESSION_COOKIE, "");
    cleared.set_http_only(true);
    cleared.set_same_site(SameSite::Lax);
    cleared.set_secure(secure);
    cleared.set_path("/");
    cleared.make_removal();

    Ok((jar.add(cleared), Json(LogoutResponse {})).into_response())
}
