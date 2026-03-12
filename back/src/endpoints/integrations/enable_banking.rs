use std::fmt;
use std::ops::Add;

use anyhow::{Context, anyhow};
use axum::{
    extract::{Query, State},
    response::{IntoResponse, Redirect},
};
use axum_extra::extract::CookieJar;
use chrono::{Duration, NaiveDate, Utc};
use cookie::{CookieBuilder, SameSite, time::OffsetDateTime};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use reqwest::ClientBuilder;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::info;
use uuid::Uuid;

use crate::{
    auth_middleware::LoggedInUser,
    config::EnableBankingConfig,
    data::{InsertManyAccount, SavedDataEnvelope},
    error::ApiError,
    state::AppState,
};

static BASE_URL: &str = "https://api.enablebanking.com";
static COOKIE_EB_AUTH_STATE: &str = "enable-banking_auth-state";

pub struct QueryAspspQuery {
    pub query: Option<String>,
    pub country: Option<String>,
}

pub async fn query_aspsps(
    eb_config: &EnableBankingConfig,
    country: Option<String>,
    query: Option<String>,
) -> Result<Vec<AspspInAspspQueryResponse>, ApiError> {
    let now = Utc::now();
    let token =
        get_token(eb_config, now.timestamp() as usize).context("error creating eb token")?;

    let base_url = BASE_URL;

    let client = ClientBuilder::new()
        .build()
        .context("error creating client")?;

    let params = if let Some(country) = country {
        &format!("&country={country}")
    } else {
        ""
    };

    let institutions_res = client
        .get(format!(
            "{base_url}/aspsps?psu_type=personal&service=AIS{params}"
        ))
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .send()
        .await
        .context("error requesting auth_url")?;

    let status = institutions_res.status();

    let aspsp_res_text = institutions_res.text().await.context(format!(
        "error getting institutions_res text status: {status}"
    ))?;

    if !status.is_success() {
        return Err(ApiError::UnexpectedError(anyhow!(format!(
            "institutions_res error {aspsp_res_text} {status}"
        ))));
    }

    let aspsp_res_parsed = serde_json::from_str::<AspspQueryResponse>(&aspsp_res_text)
        .context("error deserializing aspsp response")?;

    let mut aspsps: Vec<AspspInAspspQueryResponse> = vec![];

    if let Some(query) = query {
        aspsps = aspsp_res_parsed
            .aspsps
            .iter()
            .filter(|aspsp| aspsp.name.contains(&query))
            .cloned()
            .collect();
    }

    return Ok(aspsps);
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AspspQueryResponse {
    pub aspsps: Vec<AspspInAspspQueryResponse>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AspspInAspspQueryResponse {
    pub name: String,
    pub country: String,
    pub maximum_consent_validity: i64,
    pub required_psu_headers: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AuthResponse {
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct ConnectInitQuery {
    pub country: String,
    pub name: String,
}

pub async fn connect_init(
    State(state): State<AppState>,
    Query(query): Query<ConnectInitQuery>,
    jar: CookieJar,
) -> Result<impl IntoResponse, ApiError> {
    let eb_config = state
        .config
        .eb
        .as_ref()
        .ok_or_else(|| ApiError::UnexpectedError(anyhow!("misconfiguration")))?;

    let country_len = query.country.len();
    let country = if country_len > 2 || country_len == 0 {
        return Err(ApiError::BadRequest("Invalid country".to_string()));
    } else {
        query.country
    };

    let aspsps = query_aspsps(
        eb_config,
        Some(country.to_owned()),
        Some(query.name.to_owned()),
    )
    .await
    .context("error querying aspsps")?;
    let aspsp = aspsps
        .iter()
        .find(|aspsp| aspsp.name == query.name && aspsp.country == country)
        .ok_or(ApiError::BadRequest("Invalid query".to_owned()))?;

    info!("{aspsp:?}");

    let now = Utc::now();
    let token =
        get_token(eb_config, now.timestamp() as usize).context("error creating eb token")?;

    let client = ClientBuilder::new()
        .build()
        .context("error creating client")?;

    let base_url = BASE_URL;
    let redirect_url = format!(
        "{base_url}/api/v1/integrations/enable-banking/connect-callback",
        base_url = state.config.base_url
    );

    let auth_state = Uuid::new_v4();

    let auth_res = client
        .post(format!("{base_url}/auth"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .body(
            json!({
                "access": {
                    "valid_until": now.add(Duration::seconds(aspsp.maximum_consent_validity)).to_rfc3339(),
                },
                "aspsp": {
                  "name": aspsp.name,
                  "country": aspsp.country,
                },
                "state": auth_state.to_string(),
                "redirect_url": redirect_url,
                "psu_type": "personal",
            })
            .to_string(),
        )
        .send()
        .await
        .context("error requesting auth_url")?;

    let status = auth_res.status();
    if !status.is_success() {
        let text = auth_res
            .text()
            .await
            .context(format!("error getting auth_res text status: {status}"))?;
        return Err(ApiError::UnexpectedError(anyhow!(format!(
            "auth_res error {text} {status}"
        ))));
    }

    let auth_url = auth_res
        .json::<AuthResponse>()
        .await
        .context("error parsing token res")?
        .url;

    let state_cookie = create_eb_state_cookie(
        Some(auth_state.to_string()),
        state.config.use_secure_cookies,
    );

    return Ok((jar.add(state_cookie), Redirect::temporary(&auth_url)));
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CallbackQuery {
    pub code: String,
    pub state: String,
}

pub async fn connect_callback(
    user: LoggedInUser,
    State(state): State<AppState>,
    Query(query): Query<CallbackQuery>,
    jar: CookieJar,
) -> Result<impl IntoResponse, ApiError> {
    let eb_config = state
        .config
        .eb
        .as_ref()
        .ok_or_else(|| ApiError::UnexpectedError(anyhow!("misconfiguration")))?;

    let now = Utc::now();
    let token =
        get_token(eb_config, now.timestamp() as usize).context("error creating eb token")?;

    let code = query.code;

    let stored_state = jar
        .get(COOKIE_EB_AUTH_STATE)
        .ok_or_else(|| ApiError::BadRequest("no state".to_string()))?
        .value();

    if query.state != stored_state {
        return Err(ApiError::NoAccess("bad state".to_string()));
    }

    let client = ClientBuilder::new()
        .build()
        .context("error creating client")?;

    let base_url = BASE_URL;

    let session_res = client
        .post(format!("{base_url}/sessions"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "code": code }))
        .send()
        .await
        .context("error requesting session_res")?;

    let status = session_res.status();

    let session_text = session_res
        .text()
        .await
        .context("error getting session_res text")?;

    if !status.is_success() {
        return Err(ApiError::UnexpectedError(anyhow!(format!(
            "session_res error {session_text} {status}"
        ))));
    }

    let session =
        serde_json::from_str::<Session>(&session_text).context("error deserializing response")?;
    let integration_id = session.session_id.clone();

    let accounts = session
        .accounts
        .iter()
        .map(|remote_acc| InsertManyAccount {
            external_id: remote_acc.account_id.iban.to_owned(),
            name: format!(
                "{} {}",
                remote_acc.name.to_owned(),
                remote_acc.account_id.iban.to_owned()
            ),
        })
        .collect();

    let saved_data = SavedDataEnvelope::EnableBanking { data: session };

    state
        .data
        .set_user_bank_integration_with_accounts(
            &user.id,
            &integration_id,
            serde_json::to_value(saved_data).context("error serializing session into value")?,
            accounts,
        )
        .await
        .context("error saving user bank integration")?;

    return Ok((
        jar.remove(create_eb_state_cookie(
            Some("".to_string()),
            state.config.use_secure_cookies,
        )),
        Redirect::temporary("/"),
    ));
}

pub type SavedDataEnableBanking = Session;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub session_id: String,
    pub accounts: Vec<Account>,
    pub aspsp: Aspsp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub account_id: AccountId,
    pub uid: String,
    pub name: String,
    pub currency: String,
    #[serde(default)]
    pub last_synced_at: Option<NaiveDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountId {
    pub iban: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Aspsp {
    pub name: String,
    pub country: String,
}

impl fmt::Display for Aspsp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}", self.country, self.name)
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    iss: String,
    aud: String,
    iat: usize,
    exp: usize,
}

pub(super) fn get_token(
    eb_config: &EnableBankingConfig,
    now: usize,
) -> Result<String, anyhow::Error> {
    let claims = Claims {
        iss: "enablebanking.com".to_owned(),
        aud: "api.enablebanking.com".to_owned(),
        iat: now,
        exp: now + 3600,
    };

    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some(eb_config.application_id.to_owned());

    let encoding_key = EncodingKey::from_rsa_pem(eb_config.private_key.as_bytes())
        .context("error importing private key")?;

    let token = encode(&header, &claims, &encoding_key).context("error encoding jwt")?;

    return Ok(token);
}

pub fn create_eb_state_cookie<'a>(
    val: Option<String>,
    is_secure: bool,
) -> axum_extra::extract::cookie::Cookie<'a> {
    CookieBuilder::new(
        COOKIE_EB_AUTH_STATE,
        val.to_owned().unwrap_or("".to_string()),
    )
    .secure(is_secure)
    .http_only(true)
    .path("/")
    .same_site(SameSite::Lax)
    .expires(cookie::Expiration::from(if val.is_none() {
        OffsetDateTime::from_unix_timestamp(0).expect("epoch")
    } else {
        OffsetDateTime::now_utc().saturating_add(cookie::time::Duration::minutes(5))
    }))
    .build()
}

pub async fn delete_session(
    eb_config: &EnableBankingConfig,
    session_id: &str,
) -> Result<(), anyhow::Error> {
    let now = Utc::now();
    let token = get_token(eb_config, now.timestamp() as usize)
        .context("error creating eb token")?;

    let client = ClientBuilder::new()
        .build()
        .context("error creating client")?;

    client
        .delete(format!("{BASE_URL}/sessions/{session_id}"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .context("error deleting eb session")?;

    Ok(())
}

// --- Transaction fetching ---

#[derive(Debug, Deserialize)]
pub struct TransactionsResponse {
    pub transactions: Vec<EbTransaction>,
    pub continuation_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EbTransaction {
    pub transaction_id: Option<String>,
    pub transaction_amount: EbTransactionAmount,
    pub creditor: Option<EbParty>,
    pub debtor: Option<EbParty>,
    pub value_date: Option<String>,
    pub booking_date: Option<String>,
    pub remittance_information: Option<Vec<String>>,
    pub status: Option<String>,
    pub credit_debit_indicator: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EbTransactionAmount {
    pub currency: String,
    pub amount: String,
}

#[derive(Debug, Deserialize)]
pub struct EbParty {
    pub name: Option<String>,
}

pub async fn get_transactions_raw(
    eb_config: &EnableBankingConfig,
    account_uid: &str,
    date_from: Option<NaiveDate>,
) -> Result<Vec<serde_json::Value>, anyhow::Error> {
    let now = Utc::now();
    let token =
        get_token(eb_config, now.timestamp() as usize).context("error creating eb token")?;

    let client = ClientBuilder::new()
        .build()
        .context("error creating client")?;

    let mut all_transactions = vec![];
    let mut continuation_key: Option<String> = None;

    loop {
        let mut req = client
            .get(format!("{BASE_URL}/accounts/{account_uid}/transactions"))
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/json");

        let mut params: Vec<(&str, String)> = vec![("strategy", "longest".to_owned())];

        if let Some(ref date) = date_from {
            params.push(("date_from", date.to_string()));
        }

        if let Some(ref key) = continuation_key {
            params.push(("continuation_key", key.to_owned()));
        }

        req = req.query(&params);

        let res = req.send().await.context("error requesting transactions")?;
        let status = res.status();

        if !status.is_success() {
            let text = res.text().await.context("error reading response")?;
            return Err(anyhow!("transactions error {text} {status}"));
        }

        let page = res
            .json::<serde_json::Value>()
            .await
            .context("error parsing transactions response")?;

        if let Some(txs) = page.get("transactions").and_then(|t| t.as_array()) {
            all_transactions.extend(txs.iter().cloned());
        }

        match page.get("continuation_key").and_then(|k| k.as_str()) {
            Some(key) if !key.is_empty() => continuation_key = Some(key.to_owned()),
            _ => break,
        }
    }

    Ok(all_transactions)
}

pub async fn get_transactions(
    eb_config: &EnableBankingConfig,
    account_uid: &str,
    date_from: Option<NaiveDate>,
) -> Result<Vec<EbTransaction>, anyhow::Error> {
    let now = Utc::now();
    let token =
        get_token(eb_config, now.timestamp() as usize).context("error creating eb token")?;

    let client = ClientBuilder::new()
        .build()
        .context("error creating client")?;

    let mut all_transactions = vec![];
    let mut continuation_key: Option<String> = None;

    loop {
        let mut req = client
            .get(format!("{BASE_URL}/accounts/{account_uid}/transactions"))
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/json");

        let mut params: Vec<(&str, String)> = vec![("strategy", "longest".to_owned())];

        if let Some(ref date) = date_from {
            params.push(("date_from", date.to_string()));
        }

        if let Some(ref key) = continuation_key {
            params.push(("continuation_key", key.to_owned()));
        }

        req = req.query(&params);

        let res = req.send().await.context("error requesting transactions")?;
        let status = res.status();

        if !status.is_success() {
            let text = res.text().await.context("error reading response")?;
            return Err(anyhow!("transactions error {text} {status}"));
        }

        let page = res
            .json::<TransactionsResponse>()
            .await
            .context("error parsing transactions response")?;

        all_transactions.extend(page.transactions);

        match page.continuation_key {
            Some(key) if !key.is_empty() => continuation_key = Some(key),
            _ => break,
        }
    }

    Ok(all_transactions)
}
