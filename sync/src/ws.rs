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
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use prost::Message as _;
use tracing::{debug, warn};
use ulid::Ulid;

use crate::{
    auth::require_user_id,
    hub::{ActorCommand, BroadcastTarget},
    proto::{PushOp, ServerMessage},
    protocol::{
        ClientFrame, Delta as WireDelta, DeltaOp as WireDeltaOp, Error as WireError,
        Ready as WireReady, ServerFrame, client_frame, server_frame,
    },
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
    let user_id = match require_user_id(&state, &jar).await {
        Ok(user_id) => user_id,
        Err(err) => return err.into_response(),
    };
    ws.on_upgrade(move |socket| handle_socket(socket, state, user_id))
}

async fn handle_socket(socket: WebSocket, state: AppState, user_id: String) {
    let handle = state.hub.get_or_spawn(&user_id);
    let mut bcast_rx = handle.broadcast.subscribe();
    let inbox_tx = handle.inbox;
    let connection_id = Ulid::new().to_string();

    let (mut sender, mut receiver) = socket.split();

    // Send the initial ready frame so the client knows the socket is live.
    let ready = encode_server_message(&ServerMessage::Ready);
    if sender.send(Message::Binary(ready.into())).await.is_err() {
        return;
    }

    // Forward broadcast → socket.
    let user_id_for_send = user_id.clone();
    let connection_id_for_send = connection_id.clone();
    let mut send_task = tokio::spawn(async move {
        loop {
            match bcast_rx.recv().await {
                Ok(event) => {
                    if !should_deliver_to_connection(&event.target, &connection_id_for_send) {
                        continue;
                    }
                    let binary = encode_server_message(&event.message);
                    if sender.send(Message::Binary(binary.into())).await.is_err() {
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
    let connection_id_for_recv = connection_id;
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
                Message::Binary(bytes) => {
                    let frame = match ClientFrame::decode(bytes.as_ref()) {
                        Ok(frame) => frame,
                        Err(e) => {
                            warn!(%user_id_for_recv, "bad client frame: {:#}", e);
                            continue;
                        }
                    };

                    let push = match frame.body {
                        Some(client_frame::Body::Push(push)) => push,
                        None => {
                            warn!(%user_id_for_recv, "client frame missing body");
                            continue;
                        }
                    };

                    let ops = push
                        .ops
                        .into_iter()
                        .map(|op| PushOp {
                            id: op.id,
                            hlc: op.sync_hlc,
                            blob: base64::engine::general_purpose::STANDARD.encode(op.blob),
                            is_deleted: op.sync_is_deleted,
                        })
                        .collect();

                    if inbox_tx
                        .send(ActorCommand::Push {
                            source_connection_id: connection_id_for_recv.clone(),
                            batch_id: push.batch_id,
                            ops,
                        })
                        .await
                        .is_err()
                    {
                        warn!(%user_id_for_recv, "actor inbox closed");
                        break;
                    }
                }
                Message::Text(_) => {
                    warn!(%user_id_for_recv, "unexpected text frame");
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

fn encode_server_message(msg: &ServerMessage) -> Vec<u8> {
    let body = match msg {
        ServerMessage::Ready => server_frame::Body::Ready(WireReady {}),
        ServerMessage::Delta {
            ack_for,
            ack_max_version,
            ops,
        } => {
            let mut wire_ops = Vec::with_capacity(ops.len());
            for op in ops {
                match base64::engine::general_purpose::STANDARD.decode(op.blob.as_bytes()) {
                    Ok(blob) => wire_ops.push(WireDeltaOp {
                        id: op.id.clone(),
                        sync_hlc: op.hlc.clone(),
                        blob,
                        sync_is_deleted: op.is_deleted,
                        server_version: op.server_version,
                    }),
                    Err(e) => {
                        warn!(id = %op.id, "bad stored base64 blob in outbound delta: {:#}", e);
                    }
                }
            }

            server_frame::Body::Delta(WireDelta {
                ack_for: ack_for.clone().unwrap_or_default(),
                ops: wire_ops,
                ack_max_version: *ack_max_version,
            })
        }
        ServerMessage::Error { code, message } => server_frame::Body::Error(WireError {
            code: code.clone(),
            message: message.clone().unwrap_or_default(),
        }),
    };

    ServerFrame { body: Some(body) }.encode_to_vec()
}

fn should_deliver_to_connection(target: &BroadcastTarget, connection_id: &str) -> bool {
    match target {
        BroadcastTarget::All => true,
        BroadcastTarget::AllExceptConnection(excluded) => excluded != connection_id,
        BroadcastTarget::OnlyConnection(target) => target == connection_id,
    }
}
