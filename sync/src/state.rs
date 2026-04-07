use std::sync::Arc;
use axum::extract::FromRef;
use dashmap::DashMap;
use tokio::sync::broadcast;
use uuid::Uuid;

/// Manages per-user SSE broadcast channels for sync notifications.
#[derive(Clone, Default)]
pub struct SyncNotifier {
    channels: Arc<DashMap<Uuid, broadcast::Sender<()>>>,
}

impl SyncNotifier {
    /// Notify all connected clients for this user that new data is available.
    pub fn notify(&self, user_id: Uuid) {
        if let Some(tx) = self.channels.get(&user_id) {
            // Ignore send errors — means no receivers are listening
            let _ = tx.send(());
        }
    }

    /// Subscribe to notifications for this user. Creates channel if needed.
    pub fn subscribe(&self, user_id: Uuid) -> broadcast::Receiver<()> {
        self.channels
            .entry(user_id)
            .or_insert_with(|| broadcast::channel(16).0)
            .subscribe()
    }
}

#[derive(Clone, FromRef)]
pub struct AppState {
    pub pool: sqlx::PgPool,
    pub jwt_secret: String,
    pub notifier: SyncNotifier,
    pub cookie_secure: CookieSecure,
}

/// Whether to set the Secure flag on auth cookies (derived from CORS_ORIGIN scheme).
#[derive(Clone)]
pub struct CookieSecure(pub bool);
