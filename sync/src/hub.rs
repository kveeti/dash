use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::{broadcast, mpsc};
use tracing::error;

use crate::{
    db::Db,
    proto::{PushOp, ServerMessage},
};

const INBOX_CAP: usize = 64;
const BROADCAST_CAP: usize = 256;

/// The hub holds one actor per active user. Actors are spawned lazily on first
/// subscribe/push and live forever in the current impl; GC on last-unsubscribe
/// can be added later.
pub struct Hub {
    db: Db,
    users: DashMap<String, UserHandle>,
}

#[derive(Clone)]
pub struct UserHandle {
    pub inbox: mpsc::Sender<ActorCommand>,
    pub broadcast: broadcast::Sender<Arc<ServerMessage>>,
}

pub enum ActorCommand {
    Push { batch_id: String, ops: Vec<PushOp> },
}

impl Hub {
    pub fn new(db: Db) -> Self {
        Self {
            db,
            users: DashMap::new(),
        }
    }

    pub fn get_or_spawn(&self, user_id: &str) -> UserHandle {
        if let Some(existing) = self.users.get(user_id) {
            return existing.clone();
        }

        let (inbox_tx, inbox_rx) = mpsc::channel::<ActorCommand>(INBOX_CAP);
        let (bcast_tx, _) = broadcast::channel::<Arc<ServerMessage>>(BROADCAST_CAP);

        let handle = UserHandle {
            inbox: inbox_tx,
            broadcast: bcast_tx.clone(),
        };

        let user_id_owned = user_id.to_string();
        let db = self.db.clone();
        let bcast_for_actor = bcast_tx;
        tokio::spawn(async move {
            run_actor(user_id_owned, db, inbox_rx, bcast_for_actor).await;
        });

        // Note: small race where two callers may both spawn; entry() resolves it.
        self.users
            .entry(user_id.to_string())
            .or_insert(handle)
            .clone()
    }
}

async fn run_actor(
    user_id: String,
    db: Db,
    mut inbox: mpsc::Receiver<ActorCommand>,
    bcast: broadcast::Sender<Arc<ServerMessage>>,
) {
    while let Some(cmd) = inbox.recv().await {
        match cmd {
            ActorCommand::Push { batch_id, ops } => {
                match db.apply_push_ops(&user_id, &ops).await {
                    Ok(applied) => {
                        // Always broadcast the ack (possibly with empty ops) so
                        // the originator can clear its pending state.
                        let msg = Arc::new(ServerMessage::Delta {
                            ack_for: Some(batch_id),
                            ops: applied,
                        });
                        // send() errors only when there are no subscribers,
                        // which is fine.
                        let _ = bcast.send(msg);
                    }
                    Err(err) => {
                        error!(%user_id, "apply_push failed: {:#}", err);
                        let msg = Arc::new(ServerMessage::Error {
                            code: "push_failed".into(),
                            message: Some(format!("{err:#}")),
                        });
                        let _ = bcast.send(msg);
                    }
                }
            }
        }
    }
}
