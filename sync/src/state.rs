use std::sync::Arc;

use axum::extract::FromRef;

use crate::{auth::OidcState, hub::Hub};

#[derive(Clone, FromRef)]
pub struct AppState {
    pub pool: sqlx::PgPool,
    pub hub: Arc<Hub>,
    pub oidc: Option<OidcState>,
    pub base_url: String,
    pub session_secret: Arc<[u8]>,
}
