use std::sync::Arc;

use dashmap::{DashMap, DashSet};
use tokio::sync::broadcast;

use crate::proto::DeltaOp;

const BROADCAST_CAP: usize = 256;

#[derive(Clone)]
pub struct RealtimeEvent {
    pub source_client_id: Option<String>,
    pub ops: Vec<DeltaOp>,
}

/// One broadcast channel per user for realtime delta fanout.
pub struct Hub {
    users: DashMap<String, Arc<UserHandle>>,
}

pub struct UserHandle {
    pub broadcast: broadcast::Sender<RealtimeEvent>,
    connected_clients: DashSet<String>,
}

impl Hub {
    pub fn new() -> Self {
        Self {
            users: DashMap::new(),
        }
    }

    pub fn get_or_spawn(&self, user_id: &str) -> Arc<UserHandle> {
        if let Some(existing) = self.users.get(user_id) {
            return existing.clone();
        }

        let (bcast_tx, _) = broadcast::channel::<RealtimeEvent>(BROADCAST_CAP);

        let handle = Arc::new(UserHandle {
            broadcast: bcast_tx.clone(),
            connected_clients: DashSet::new(),
        });

        // Small race where two callers may both create; entry() resolves it.
        self.users
            .entry(user_id.to_string())
            .or_insert_with(|| handle.clone())
            .clone()
    }

    pub fn register_client(&self, user_id: &str, client_id: &str) -> broadcast::Receiver<RealtimeEvent> {
        let handle = self.get_or_spawn(user_id);
        handle.connected_clients.insert(client_id.to_string());
        handle.broadcast.subscribe()
    }

    pub fn unregister_client(&self, user_id: &str, client_id: &str) {
        let Some(handle) = self.users.get(user_id).map(|h| h.clone()) else {
            return;
        };
        handle.connected_clients.remove(client_id);
    }

    pub fn publish_delta(&self, user_id: &str, source_client_id: String, ops: Vec<DeltaOp>) {
        if ops.is_empty() {
            return;
        }

        let handle = self.get_or_spawn(user_id);
        let _ = handle.broadcast.send(RealtimeEvent {
            ops,
            source_client_id: Some(source_client_id),
        });
    }
}
