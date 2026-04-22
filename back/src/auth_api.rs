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
use std::time::{SystemTime, UNIX_EPOCH};
use ulid::Ulid;

use crate::{
    auth::{AUTH_SESSION_COOKIE, require_user_id},
    error::ApiError,
    state::{AppState, AuthChallenge},
};

const CHALLENGE_TTL_SECS: i64 = 120;
const MAX_ACTIVE_CHALLENGES: usize = 10_000;
const MAX_ACTIVE_CHALLENGES_PER_USER: usize = 10;
const AUTH_ID_CONTEXT: &str = "dash/auth/id/v1";

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
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/challenge", post(challenge))
        .route("/auth/verify", post(verify))
        .route("/auth/logout", post(logout))
        .route("/auth/@me", get(me))
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn random_nonce_b64url() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

fn verify_signature(
    auth_public_key_b64url: &str,
    challenge_id: &str,
    nonce: &str,
    signature_b64url: &str,
) -> Result<bool, ApiError> {
    let public_key = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(auth_public_key_b64url.as_bytes())
        .map_err(|_| ApiError::Unauthorized)?;
    let signature = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(signature_b64url.as_bytes())
        .map_err(|_| ApiError::Unauthorized)?;
    let payload = format!("{challenge_id}:{nonce}");
    let verifier = UnparsedPublicKey::new(&ED25519, public_key);
    Ok(verifier.verify(payload.as_bytes(), &signature).is_ok())
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

fn prune_expired_challenges(state: &AppState, now: i64) {
    state
        .auth_challenges
        .retain(|_challenge_id, challenge| challenge.expires_at_unix > now);
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

    let now = now_unix();
    prune_expired_challenges(&state, now);
    let active_for_user = state
        .auth_challenges
        .iter()
        .filter(|entry| entry.user_id == user_id)
        .count();
    if active_for_user >= MAX_ACTIVE_CHALLENGES_PER_USER {
        return Err(ApiError::TooManyRequests(
            "too many active auth challenges".to_string(),
        ));
    }
    if state.auth_challenges.len() >= MAX_ACTIVE_CHALLENGES {
        return Err(ApiError::TooManyRequests(
            "auth challenge capacity reached".to_string(),
        ));
    }

    let challenge_id = Ulid::new().to_string();
    let nonce = random_nonce_b64url();
    let expires_at_unix = now + CHALLENGE_TTL_SECS;
    state.auth_challenges.insert(
        challenge_id.clone(),
        AuthChallenge {
            user_id,
            nonce: nonce.clone(),
            expires_at_unix,
        },
    );

    Ok(Json(ChallengeResponse {
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

    let now = now_unix();
    prune_expired_challenges(&state, now);
    let Some((_key, challenge)) = state.auth_challenges.remove(body.challenge_id.trim()) else {
        return Err(ApiError::Unauthorized);
    };

    if challenge.user_id != user_id {
        return Err(ApiError::Unauthorized);
    }
    if now > challenge.expires_at_unix {
        return Err(ApiError::Unauthorized);
    }

    let ok = verify_signature(
        &auth_public_key,
        body.challenge_id.trim(),
        &challenge.nonce,
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
