use axum::{
    Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::{IntoResponse, Response},
    routing::get,
};
use axum_extra::extract::CookieJar;
use futures_util::{SinkExt, StreamExt};
use hyper::StatusCode;
use tracing::{debug, warn};

use crate::{
    auth::user_id_from_jar,
    hub::ActorCommand,
    proto::{ClientMessage, ServerMessage},
    state::AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new().route("/ws", get(ws_upgrade))
}

async fn ws_upgrade(
    State(state): State<AppState>,
    jar: CookieJar,
    ws: WebSocketUpgrade,
) -> Response {
    let Some(user_id) = user_id_from_jar(&jar) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    ws.on_upgrade(move |socket| handle_socket(socket, state, user_id))
}

async fn handle_socket(socket: WebSocket, state: AppState, user_id: String) {
    let handle = state.hub.get_or_spawn(&user_id);
    let mut bcast_rx = handle.broadcast.subscribe();
    let inbox_tx = handle.inbox;

    let (mut sender, mut receiver) = socket.split();

    // Send the initial ready frame so the client knows the socket is live.
    let ready = match serde_json::to_string(&ServerMessage::Ready) {
        Ok(t) => t,
        Err(e) => {
            warn!("serialize ready: {:#}", e);
            return;
        }
    };
    if sender.send(Message::Text(ready.into())).await.is_err() {
        return;
    }

    // Forward broadcast → socket.
    let user_id_for_send = user_id.clone();
    let mut send_task = tokio::spawn(async move {
        loop {
            match bcast_rx.recv().await {
                Ok(msg) => {
                    let text = match serde_json::to_string(&*msg) {
                        Ok(t) => t,
                        Err(e) => {
                            warn!("serialize outbound: {:#}", e);
                            continue;
                        }
                    };
                    if sender.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    // Slow consumer dropped messages. Close the socket; client will
                    // reconnect and re-bootstrap via cursor. Upserts are idempotent.
                    warn!(user_id = %user_id_for_send, "ws broadcast lagged by {n}, dropping socket");
                    let _ = sender.send(Message::Close(None)).await;
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Read client → dispatch to actor.
    let user_id_for_recv = user_id;
    let mut recv_task = tokio::spawn(async move {
        while let Some(next) = receiver.next().await {
            let msg = match next {
                Ok(m) => m,
                Err(e) => {
                    debug!(%user_id_for_recv, "ws recv err: {:#}", e);
                    break;
                }
            };
            match msg {
                Message::Text(text) => {
                    let parsed: Result<ClientMessage, _> = serde_json::from_str(&text);
                    match parsed {
                        Ok(ClientMessage::Push { batch_id, ops }) => {
                            if inbox_tx
                                .send(ActorCommand::Push { batch_id, ops })
                                .await
                                .is_err()
                            {
                                warn!(%user_id_for_recv, "actor inbox closed");
                                break;
                            }
                        }
                        Err(e) => {
                            warn!(%user_id_for_recv, "bad client frame: {:#}", e);
                        }
                    }
                }
                Message::Binary(_) => {
                    warn!(%user_id_for_recv, "unexpected binary frame");
                }
                Message::Ping(_) | Message::Pong(_) => {
                    // axum/tungstenite handle protocol-level ping/pong transparently.
                }
                Message::Close(_) => break,
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => { recv_task.abort(); }
        _ = &mut recv_task => { send_task.abort(); }
    }
}
