use std::{fmt, str::FromStr};

use anyhow::{Context, anyhow};
use axum::{
    extract::{Query, State},
    response::{IntoResponse, Redirect},
};
use axum_extra::{
    TypedHeader,
    headers::{self},
};
use chrono::Utc;
use cookie::{
    CookieBuilder, SameSite,
    time::{Duration, OffsetDateTime},
};
use hmac::{Hmac, Mac};
use http::HeaderValue;
use hyper::{HeaderMap, header};
use openidconnect::{
    AccessTokenHash, AuthorizationCode, Client, ClientId, ClientSecret, CsrfToken,
    EmptyAdditionalClaims, EndpointMaybeSet, EndpointNotSet, EndpointSet, IssuerUrl, Nonce,
    OAuth2TokenResponse, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope,
    StandardErrorResponse, TokenResponse,
    core::{
        CoreAuthDisplay, CoreAuthPrompt, CoreAuthenticationFlow, CoreClient, CoreErrorResponseType,
        CoreGenderClaim, CoreJsonWebKey, CoreJweContentEncryptionAlgorithm, CoreProviderMetadata,
        CoreRevocableToken, CoreRevocationErrorResponse, CoreTokenIntrospectionResponse,
        CoreTokenResponse,
    },
};
use reqwest::{ClientBuilder, redirect};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use utoipa::IntoParams;

use crate::{
    auth_middleware::LoggedInUser,
    config::Config,
    data::{Session, User, create_id},
    error::ApiError,
    state::AppState,
};

const COOKIE_AUTH_STATE: &'static str = "auth_state";
pub const COOKIE_AUTH: &'static str = "auth";

#[utoipa::path(
    get,
    path = "/v1/auth/init",
    responses(
        (status = 307)
    )
)]
pub async fn init(
    State(state): State<AppState>,
    user: Option<LoggedInUser>,
) -> Result<impl IntoResponse, ApiError> {
    if user.is_some() {
        return Ok((Redirect::temporary(&state.config.front_base_url)).into_response());
    }

    let (_, oidc_client) = create_oidc(&state.config).await?;

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let (auth_url, csrf_token, nonce) = oidc_client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("openid".to_string()))
        .set_pkce_challenge(pkce_challenge)
        .url();

    let auth_state = AuthState::new(nonce, csrf_token, pkce_verifier);

    let mut headers = HeaderMap::new();
    headers.append(
        header::SET_COOKIE,
        create_state_cookie(
            Some(&auth_state.to_string()),
            state.config.use_secure_cookies,
        ),
    );

    return Ok((headers, Redirect::temporary(&auth_url.to_string())).into_response());
}

#[derive(IntoParams, Deserialize)]
pub struct AuthCallbackQuery {
    pub code: String,
    pub state: String,
}

#[utoipa::path(
    get,
    path = "/auth/callback",
    params(
        AuthCallbackQuery
    ),
    responses(
        (status = 200)
    )
)]
pub async fn callback(
    State(state): State<AppState>,
    Query(query): Query<AuthCallbackQuery>,
    TypedHeader(cookies): TypedHeader<headers::Cookie>,
    user: Option<LoggedInUser>,
) -> Result<impl IntoResponse, ApiError> {
    if user.is_some() {
        return Ok((Redirect::temporary(&state.config.front_base_url)).into_response());
    }

    let (http_client, oidc_client) = create_oidc(&state.config).await?;

    let auth_state = AuthState::from_str(
        cookies
            .get(COOKIE_AUTH_STATE)
            .ok_or(ApiError::BadRequest("no state".to_owned()))?,
    )
    .context("error")?;
    if CsrfToken::new(query.state) != auth_state.csrf {
        return Err(ApiError::NoAccess("invalid csrf".to_owned()));
    }

    let token_response = oidc_client
        .exchange_code(AuthorizationCode::new(query.code.to_string()))
        .context("auth code exchange")?
        .set_pkce_verifier(auth_state.pkce)
        .request_async(&http_client)
        .await
        .context("token response")?;

    let id_token = token_response
        .id_token()
        .context("idp did not return an id token")?;
    let id_token_verifier = oidc_client.id_token_verifier();
    let claims = id_token
        .claims(&id_token_verifier, &auth_state.nonce)
        .context("error verifying claims")?;
    if let Some(expected_access_token_hash) = claims.access_token_hash() {
        let actual_access_token_hash = AccessTokenHash::from_token(
            token_response.access_token(),
            id_token.signing_alg().context("id_token signing_alg")?,
            id_token
                .signing_key(&id_token_verifier)
                .context("id_token signing_key")?,
        )
        .context("from_token")?;
        if actual_access_token_hash != *expected_access_token_hash {
            return Err(ApiError::NoAccess("invalid token".to_string()));
        }
    }

    let external_id = claims.subject().to_string();
    let existing_user_id = state
        .data
        .get_user_id_by_external_id(&external_id)
        .await
        .context("error getting user by external id")?;

    let session_id = create_id();
    let created_at = Utc::now();
    let updated_at = None;
    let user_id = match existing_user_id {
        Some(user_id) => {
            state
                .data
                .insert_session(&user_id, &session_id)
                .await
                .context("error inserting session")?;

            user_id
        }
        None => {
            let user = User {
                id: create_id(),
                external_id,
                created_at,
                updated_at,
            };

            let session = Session {
                id: session_id.to_owned(),
                user_id: user.id.to_owned(),
                created_at,
                updated_at,
            };

            state
                .data
                .upsert_user_with_session(&user, &session)
                .await
                .context("error upserting user and session")?;

            user.id
        }
    };

    let mut headers = HeaderMap::new();
    headers.append(
        header::SET_COOKIE,
        create_auth_cookie(
            Some(&create_token(&state.config.secret, &user_id, &session_id)),
            state.config.use_secure_cookies,
        ),
    );
    headers.append(
        header::SET_COOKIE,
        create_state_cookie(None, state.config.use_secure_cookies),
    );

    return Ok((headers, Redirect::temporary(&state.config.front_base_url)).into_response());
}

#[utoipa::path(
    get,
    path = "/v1/auth/logout",
    responses(
        (status = 307)
    )
)]
pub async fn logout(
    State(state): State<AppState>,
    user: Option<LoggedInUser>,
) -> Result<impl IntoResponse, ApiError> {
    let mut headers = HeaderMap::new();
    headers.append(
        header::SET_COOKIE,
        create_state_cookie(None, state.config.use_secure_cookies),
    );
    headers.append(
        header::SET_COOKIE,
        create_auth_cookie(None, state.config.use_secure_cookies),
    );

    if let Some(user) = user {
        state
            .data
            .delete_session(&user.id, &user.session_id)
            .await
            .unwrap_or_else(|_| {
                tracing::error!("error deleting session on logout for user {}", user.id);
            });
    }

    return Ok((headers, Redirect::temporary(&state.config.front_base_url)));
}

#[cfg(debug_assertions)]
#[utoipa::path(
    get,
    path = "/auth/___dev_login___",
    responses(
        (status = 200)
    )
)]
pub async fn ___dev_login___(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    let created_at = Utc::now();
    let updated_at = None;

    let user = User {
        id: create_id(),
        external_id: create_id(),
        created_at,
        updated_at,
    };

    let session = Session {
        id: create_id(),
        user_id: user.id.to_owned(),
        created_at,
        updated_at,
    };

    state
        .data
        .upsert_user_with_session(&user, &session)
        .await
        .context("error upserting user and session")?;

    let mut headers = HeaderMap::new();
    headers.append(
        header::SET_COOKIE,
        create_auth_cookie(
            Some(&create_token(&state.config.secret, &user.id, &session.id)),
            state.config.use_secure_cookies,
        ),
    );

    return Ok((headers, Redirect::temporary(&state.config.front_base_url)));
}

fn create_auth_cookie(val: Option<&str>, is_secure: bool) -> HeaderValue {
    CookieBuilder::new(COOKIE_AUTH, val.unwrap_or(""))
        .secure(is_secure)
        .same_site(cookie::SameSite::Lax)
        .http_only(true)
        .path("/")
        .expires(cookie::Expiration::from(if val.is_none() {
            OffsetDateTime::from_unix_timestamp(0).expect("epoch")
        } else {
            OffsetDateTime::now_utc().saturating_add(Duration::days(7))
        }))
        .build()
        .to_string()
        .parse()
        .expect("parsing auth cookie")
}

pub fn create_state_cookie(val: Option<&str>, is_secure: bool) -> HeaderValue {
    CookieBuilder::new(COOKIE_AUTH_STATE, val.unwrap_or(""))
        .secure(is_secure)
        .http_only(true)
        .path("/")
        .same_site(SameSite::Lax)
        .expires(cookie::Expiration::from(if val.is_none() {
            OffsetDateTime::from_unix_timestamp(0).expect("epoch")
        } else {
            OffsetDateTime::now_utc().saturating_add(Duration::minutes(5))
        }))
        .build()
        .to_string()
        .parse()
        .expect("parsing state cookie")
}

async fn create_oidc(config: &Config) -> Result<(reqwest::Client, OidcClient), ApiError> {
    let http_client = ClientBuilder::new()
        .redirect(redirect::Policy::none())
        .build()
        .context("error creating auth http client")?;

    let provider_metadata = CoreProviderMetadata::discover_async(
        IssuerUrl::new(config.auth_url.to_owned()).context("issuer url")?,
        &http_client,
    )
    .await
    .context("error discovering provider metadata")?;

    let client = CoreClient::from_provider_metadata(
        provider_metadata,
        ClientId::new(config.auth_client_id.to_owned()),
        Some(ClientSecret::new(config.auth_client_secret.to_owned())),
    )
    .set_redirect_uri(
        RedirectUrl::new(format!(
            "{base}/api/v1/auth/callback",
            base = config.back_base_url
        ))
        .context("error parsing auth redirect url")?,
    );

    Ok((http_client, client))
}

pub type OidcClient<
    HasAuthUrl = EndpointSet,
    HasDeviceAuthUrl = EndpointNotSet,
    HasIntrospectionUrl = EndpointNotSet,
    HasRevocationUrl = EndpointNotSet,
    HasTokenUrl = EndpointMaybeSet,
    HasUserInfoUrl = EndpointMaybeSet,
> = Client<
    EmptyAdditionalClaims,
    CoreAuthDisplay,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJsonWebKey,
    CoreAuthPrompt,
    StandardErrorResponse<CoreErrorResponseType>,
    CoreTokenResponse,
    CoreTokenIntrospectionResponse,
    CoreRevocableToken,
    CoreRevocationErrorResponse,
    HasAuthUrl,
    HasDeviceAuthUrl,
    HasIntrospectionUrl,
    HasRevocationUrl,
    HasTokenUrl,
    HasUserInfoUrl,
>;

#[derive(Serialize, Deserialize)]
pub struct AuthState {
    pub nonce: Nonce,
    pub csrf: CsrfToken,
    pub pkce: PkceCodeVerifier,
}

impl AuthState {
    pub fn new(nonce: Nonce, csrf: CsrfToken, pkce: PkceCodeVerifier) -> Self {
        Self { nonce, csrf, pkce }
    }
}

impl fmt::Display for AuthState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}:{}:{}",
            self.nonce.secret(),
            self.csrf.secret(),
            self.pkce.secret()
        )
    }
}

impl FromStr for AuthState {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() != 3 {
            return Err(anyhow!("invalid format"));
        }

        let nonce = Nonce::new(parts[0].to_owned());
        let csrf = CsrfToken::new(parts[1].to_owned());
        let pkce = PkceCodeVerifier::new(parts[2].to_owned());

        Ok(AuthState::new(nonce, csrf, pkce))
    }
}

impl From<AuthState> for String {
    fn from(auth_state: AuthState) -> String {
        auth_state.to_string()
    }
}

impl From<&AuthState> for String {
    fn from(auth_state: &AuthState) -> String {
        auth_state.to_string()
    }
}

pub struct Token {
    pub user_id: String,
    pub session_id: String,
}

static ID_SPLITTER: &str = ".";
static SIGNATURE_SPLITTER: &str = ":";

type HmacSha256 = Hmac<Sha256>;

fn create_signature(secret: &str, data_to_sign: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("error creating hmac");

    mac.update(data_to_sign.as_bytes());

    let result = mac.finalize();
    let result = result.into_bytes();

    return hex::encode(result);
}

pub fn create_token(secret: &str, user_id: &str, session_id: &str) -> String {
    let data = format!("{user_id}{ID_SPLITTER}{session_id}");

    let signature = create_signature(secret, &data);

    return format!("{data}{SIGNATURE_SPLITTER}{signature}");
}

pub fn verify_token(secret: &str, token: &str) -> Result<Token, anyhow::Error> {
    let parts: Vec<&str> = token.split(SIGNATURE_SPLITTER).collect();

    if parts.len() != 2 {
        return Err(anyhow::anyhow!(
            "could not split token into data and signature"
        ));
    }

    let data = parts[0];
    let signature = parts[1];

    let expected_signature = create_signature(secret, data);

    if signature != expected_signature {
        return Err(anyhow::anyhow!("invalid signature"));
    }

    let parts: Vec<&str> = data.split(ID_SPLITTER).collect();

    if parts.len() != 2 {
        return Err(anyhow::anyhow!(
            "could not split token data into user_id and session_id"
        ));
    }

    let user_id = parts[0];
    let session_id = parts[1];

    return Ok(Token {
        user_id: user_id.to_string(),
        session_id: session_id.to_string(),
    });
}
