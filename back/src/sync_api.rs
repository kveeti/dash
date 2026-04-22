use std::{convert::Infallible, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::State,
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::{get, post},
};
use axum_extra::extract::{
    CookieJar,
    cookie::{Cookie, SameSite},
};
use futures_util::{StreamExt, stream};
use serde::{Deserialize, Serialize};
use tracing::warn;
use ulid::Ulid;

use crate::{
    auth::require_user_id,
    error::ApiError,
    hub::Hub,
    proto::{DeltaOp, PushOp},
    state::AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/events", get(events))
        .route("/push", post(push))
}

const SYNC_CLIENT_COOKIE: &str = "sync_client_id";

struct HubClientRegistration {
    hub: Arc<Hub>,
    user_id: String,
    client_id: String,
}

impl Drop for HubClientRegistration {
    fn drop(&mut self) {
        self.hub.unregister_client(&self.user_id, &self.client_id);
    }
}

#[derive(Debug, Deserialize)]
struct PushRequest {
    ops: Vec<PushOp>,
}

#[derive(Debug, Serialize)]
struct PushResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    ack_max_version: Option<i64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    not_applied_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
struct ReadyEvent {}

#[derive(Debug, Serialize)]
struct DeltaEvent {
    ops: Vec<DeltaOp>,
}

async fn push(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<PushRequest>,
) -> Result<Response, ApiError> {
    let user_id = require_user_id(&state, &jar).await?;
    let secure = state.base_url.starts_with("https://");
    let (jar, source_client_id) = get_or_issue_sync_client_id(jar, secure);
    let result = state
        .db
        .apply_push_ops(&user_id, &body.ops)
        .await
        .map_err(ApiError::UnexpectedError)?;
    let ack_max_version = result.applied.last().map(|op| op.server_version);
    let not_applied_ids = result.not_applied_ids;
    state
        .hub
        .publish_delta(&user_id, source_client_id, result.applied);

    Ok((
        jar,
        Json(PushResponse {
            ack_max_version,
            not_applied_ids,
        }),
    )
        .into_response())
}

async fn events(State(state): State<AppState>, jar: CookieJar) -> Result<Response, ApiError> {
    let user_id = require_user_id(&state, &jar).await?;
    let secure = state.base_url.starts_with("https://");
    let (jar, client_id) = get_or_issue_sync_client_id(jar, secure);
    let bcast_rx = state.hub.register_client(&user_id, &client_id);
    let registration = HubClientRegistration {
        hub: state.hub.clone(),
        user_id: user_id.clone(),
        client_id: client_id.clone(),
    };

    let user_id_for_stream = user_id;
    let realtime_stream = stream::unfold(
        (bcast_rx, registration),
        move |(mut rx, registration)| {
            let user_id_for_stream = user_id_for_stream.clone();
            let client_id = client_id.clone();
            async move {
                loop {
                    match rx.recv().await {
                        Ok(msg) => {
                            if msg.source_client_id.as_deref() == Some(client_id.as_str()) {
                                continue;
                            }

                            let payload = match serde_json::to_string(&DeltaEvent { ops: msg.ops })
                            {
                                Ok(payload) => payload,
                                Err(err) => {
                                    warn!("serialize sse frame failed: {:#}", err);
                                    continue;
                                }
                            };
                            return Some((
                                Ok::<Event, Infallible>(
                                    Event::default().event("delta").data(payload),
                                ),
                                (rx, registration),
                            ));
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            warn!(user_id = %user_id_for_stream, "sse broadcast lagged by {n}, closing stream");
                            return None;
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
                    }
                }
            }
        },
    );

    let ready_payload = serde_json::to_string(&ReadyEvent {})
        .map_err(|err| ApiError::UnexpectedError(anyhow::anyhow!(err)))?;
    let initial_ready = stream::once(async move {
        Ok::<Event, Infallible>(Event::default().event("ready").data(ready_payload))
    });
    let stream = initial_ready.chain(realtime_stream);

    let sse = Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    );

    Ok((jar, sse).into_response())
}

fn get_or_issue_sync_client_id(jar: CookieJar, secure: bool) -> (CookieJar, String) {
    if let Some(cookie) = jar.get(SYNC_CLIENT_COOKIE) {
        let value = cookie.value().to_string();
        if value.parse::<Ulid>().is_ok() {
            return (jar, value);
        }
    }

    let id = Ulid::new().to_string();
    let mut cookie = Cookie::new(SYNC_CLIENT_COOKIE, id.clone());
    cookie.set_http_only(true);
    cookie.set_same_site(SameSite::Lax);
    cookie.set_secure(secure);
    cookie.set_path("/");
    (jar.add(cookie), id)
}
