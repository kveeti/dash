use std::sync::Arc;

use crate::endpoints::*;
use axum::{
    Router,
    routing::{get, post},
};
use config::Config;
use data::Data;
use http::{HeaderValue, Method, header};
use state::AppState;
use tokio::{net::TcpListener, signal};
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub mod auth_middleware;
pub mod config;
pub mod data;
pub mod endpoints;
pub mod error;
mod services;
pub mod state;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| format!("{}=debug", env!("CARGO_CRATE_NAME")).into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Arc::new(Config::new().expect("config"));
    let data = Data::new(&config).await.expect("data");
    let state = AppState {
        config: config.clone(),
        data,
    };

    let auth_base = Router::new()
        .route("/init", get(auth::init))
        .route("/callback", get(auth::callback));

    // dev login in debug mode
    #[cfg(debug_assertions)]
    let auth = auth_base.route("/auth/___dev_login___", post(auth::___dev_login___));
    #[cfg(not(debug_assertions))]
    let auth = auth_base;

    let routes = Router::new()
        .nest("/auth", auth)
        .route("/@me", get(me::get_me))
        .route("/openapi.json", get(openapi))
        .layer(cors(&config))
        .with_state(state);

    let api = Router::new().nest("/api", routes);

    let listener = TcpListener::bind("127.0.0.1:8000").await.unwrap();
    tracing::debug!("listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, api)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

fn cors(config: &Config) -> CorsLayer {
    CorsLayer::new()
        .allow_methods([
            Method::OPTIONS,
            Method::HEAD,
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::ACCEPT,
            header::ACCEPT_ENCODING,
            header::ACCEPT_LANGUAGE,
        ])
        .allow_origin(
            config
                .front_base_url
                .parse::<HeaderValue>()
                .expect("allow origin value"),
        )
        .allow_credentials(true)
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("error installing ctrl+c handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("error installing signal handler")
            .recv()
            .await;
    };

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
