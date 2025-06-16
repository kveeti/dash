use std::sync::Arc;

use axum::extract::FromRef;

use crate::{config::Config, data::Data};

#[derive(Clone, FromRef)]
pub struct AppState {
    pub data: Data,
    pub config: Arc<Config>,
}
