use axum::extract::FromRef;

use crate::{db::Db, hub::Hub};

#[derive(Clone, FromRef)]
pub struct AppState {
    pub db: Db,
    pub hub: std::sync::Arc<Hub>,
    pub base_url: String,
    pub session_ttl_days: i64,
}
