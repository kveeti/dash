use crate::{
    config::Config,
    data::{Data, Session, User, create_id},
    error::ApiError,
};

use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use once_cell::sync::Lazy;
use rand::{TryRngCore, rngs::OsRng};
use reqwest::{Client, ClientBuilder, redirect};
use serde::Deserialize;
use sha2::Sha256;

pub fn init(config: &Config) -> Result<(String, String)> {
    let state = generate_state().context("error generating state")?;

    let url = format!(
        "{url}?client_id={client_id}&redirect_uri={redirect_uri}&scope={scope}&response_type={response_type}&state={state}",
        url = config.auth_init_url,
        client_id = config.auth_client_id,
        redirect_uri = format!("{url}/api/auth/callback", url = config.back_base_url),
        scope = "openid%20email",
        response_type = "code",
        state = state,
    );

    return Ok((url, state));
}

fn generate_state() -> Result<String> {
    let mut bytes = [0u8; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .context("error generating random")?;

    return Ok(URL_SAFE_NO_PAD.encode(&bytes));
}

pub static AUTH_CLIENT: Lazy<Client> = Lazy::new(|| {
    ClientBuilder::new()
        .redirect(redirect::Policy::none())
        .build()
        .expect("creating AUTH_CLIENT")
});

#[derive(Deserialize)]
struct TokenRes {
    pub access_token: String,
}

#[derive(Deserialize)]
struct UserInfoRes {
    pub sub: String,
}

pub async fn callback(
    config: &Config,
    data: &Data,
    code: &str,
    state: &str,
    stored_state: &str,
) -> Result<String, ApiError> {
    if state != stored_state {
        return Err(ApiError::BadRequest("states dont match".to_string()));
    }

    let token_res = AUTH_CLIENT
        .post(&config.auth_token_url)
        .form(&[
            ("code", code),
            ("client_id", &config.auth_client_id),
            ("client_secret", &config.auth_client_secret),
            (
                "redirect_uri",
                &format!("{url}/api/auth/callback", url = config.back_base_url),
            ),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .context("error executing token req")?
        .json::<TokenRes>()
        .await
        .context("error parsing token res")?;

    let userinfo_res = AUTH_CLIENT
        .get(&config.auth_userinfo_url)
        .bearer_auth(token_res.access_token)
        .send()
        .await
        .context("error executing token req")?
        .json::<UserInfoRes>()
        .await
        .context("error parsing userinfo res json")?;

    let user = User {
        external_id: userinfo_res.sub.to_string(),
        id: create_id(),
    };

    let session = Session {
        id: create_id(),
        user_id: user.id.to_owned(),
    };

    data.users
        .upsert_with_session(&user, &session)
        .await
        .context("error upserting user and session")?;

    let token = create_token(&config.secret, &user.id, &session.id);

    return Ok(token);
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
