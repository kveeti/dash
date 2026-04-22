use axum::extract::FromRef;
use dashmap::DashMap;

use crate::{db::Db, hub::Hub};

#[derive(Clone)]
pub struct AuthChallenge {
    pub user_id: String,
    pub nonce: String,
    pub expires_at_unix: i64,
}

#[derive(Clone, FromRef)]
pub struct AppState {
    pub db: Db,
    pub hub: std::sync::Arc<Hub>,
    pub base_url: String,
    pub session_ttl_days: i64,
    pub auth_challenges: std::sync::Arc<DashMap<String, AuthChallenge>>,
}
