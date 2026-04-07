use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{Json, extract::State, extract::Path, response::IntoResponse};
use axum::http::header::SET_COOKIE;
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use ulid::Ulid;
use uuid::Uuid;

use crate::error::ApiError;
use crate::middleware::create_token;
use crate::state::{AppState, CookieSecure};

const COOKIE_NAME: &str = "dash_token";
const COOKIE_MAX_AGE: i64 = 7 * 24 * 3600; // 7 days

fn make_set_cookie(token: &str, secure: bool) -> String {
    let secure_flag = if secure { "; Secure" } else { "" };
    format!(
        "{COOKIE_NAME}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={COOKIE_MAX_AGE}{secure_flag}"
    )
}

#[derive(Deserialize)]
pub struct SignupRequest {
    pub server_salt: String,
    pub auth_key: String,
    pub encrypted_dek: String,
}

#[derive(Serialize)]
pub struct SignupResponse {
    pub user_id: String,
}

pub async fn signup(
    State(state): State<AppState>,
    State(CookieSecure(secure)): State<CookieSecure>,
    Json(req): Json<SignupRequest>,
) -> Result<impl IntoResponse, ApiError> {
    // Decode auth_key from base64
    let auth_key_bytes = BASE64
        .decode(&req.auth_key)
        .map_err(|_| ApiError::BadRequest("invalid auth_key encoding".into()))?;

    // Hash auth_key with Argon2id
    let salt = SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
    let argon2 = Argon2::default();
    let auth_hash = argon2
        .hash_password(&auth_key_bytes, &salt)
        .map_err(|e| anyhow::anyhow!("failed to hash: {e}"))?
        .to_string();

    let ulid = Ulid::new();
    let user_id: Uuid = ulid.into();

    sqlx::query(
        "INSERT INTO identities (id, auth_hash, server_salt, encrypted_dek) VALUES ($1, $2, $3, $4)"
    )
    .bind(user_id)
    .bind(&auth_hash)
    .bind(&req.server_salt)
    .bind(&req.encrypted_dek)
    .execute(&state.pool)
    .await?;

    let token = create_token(user_id, &state.jwt_secret)
        .map_err(|e| anyhow::anyhow!("failed to create token: {e}"))?;

    Ok((
        [(SET_COOKIE, make_set_cookie(&token, secure))],
        Json(SignupResponse { user_id: ulid.to_string() }),
    ))
}

#[derive(Serialize)]
pub struct SaltResponse {
    pub server_salt: String,
}

pub async fn get_salt(
    State(pool): State<PgPool>,
    Path(user_id): Path<String>,
) -> Result<Json<SaltResponse>, ApiError> {
    let uuid: Uuid = Ulid::from_string(&user_id)
        .map_err(|_| ApiError::BadRequest("invalid user_id".into()))?
        .into();

    let row = sqlx::query_as::<_, (String,)>(
        "SELECT server_salt FROM identities WHERE id = $1"
    )
    .bind(uuid)
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| ApiError::NotFound("identity not found".into()))?;

    Ok(Json(SaltResponse { server_salt: row.0 }))
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub user_id: String,
    pub auth_key: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub encrypted_dek: Option<String>,
    pub server_salt: String,
}

pub async fn login(
    State(state): State<AppState>,
    State(CookieSecure(secure)): State<CookieSecure>,
    Json(req): Json<LoginRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let uuid: Uuid = Ulid::from_string(&req.user_id)
        .map_err(|_| ApiError::BadRequest("invalid user_id".into()))?
        .into();

    let row = sqlx::query_as::<_, (String, String, Option<String>)>(
        "SELECT auth_hash, server_salt, encrypted_dek FROM identities WHERE id = $1"
    )
    .bind(uuid)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::Unauthorized)?;

    let (auth_hash, server_salt, encrypted_dek) = row;

    let auth_key_bytes = BASE64
        .decode(&req.auth_key)
        .map_err(|_| ApiError::BadRequest("invalid auth_key encoding".into()))?;

    let parsed_hash = PasswordHash::new(&auth_hash)
        .map_err(|e| anyhow::anyhow!("invalid stored hash: {e}"))?;

    Argon2::default()
        .verify_password(&auth_key_bytes, &parsed_hash)
        .map_err(|_| ApiError::Unauthorized)?;

    let token = create_token(uuid, &state.jwt_secret)
        .map_err(|e| anyhow::anyhow!("failed to create token: {e}"))?;

    Ok((
        [(SET_COOKIE, make_set_cookie(&token, secure))],
        Json(LoginResponse {
            encrypted_dek,
            server_salt,
        }),
    ))
}

pub async fn logout(
    State(CookieSecure(secure)): State<CookieSecure>,
) -> impl IntoResponse {
    let secure_flag = if secure { "; Secure" } else { "" };
    (
        [(SET_COOKIE, format!("{COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0{secure_flag}"))],
        Json(serde_json::json!({ "ok": true })),
    )
}
