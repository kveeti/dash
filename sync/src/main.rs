use std::sync::Arc;

use axum::{Router, http::Method, routing::get};
use sqlx::{PgPool, migrate};
use state::AppState;
use tokio::{net::TcpListener, signal};
use tower_http::cors::{Any, CorsLayer};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod auth;
mod bootstrap;
mod config;
mod error;
mod hub;
mod proto;
mod state;
mod ws;

use hub::Hub;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sync=debug,tower_http=info,sqlx=info".into()),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .with_line_number(cfg!(debug_assertions))
                .with_file(cfg!(debug_assertions))
                .with_target(cfg!(debug_assertions)),
        )
        .init();

    let config = config::Config::new().expect("config");

    info!("connecting to db...");
    let pool = PgPool::connect(&config.database_url)
        .await
        .expect("failed to connect to database");

    info!("running migrations...");
    migrate!()
        .run(&pool)
        .await
        .expect("failed to run migrations");

    let hub = Arc::new(Hub::new(pool.clone()));
    let oidc = config.oidc.map(auth::OidcState::new);

    let state = AppState {
        pool,
        hub,
        oidc,
        base_url: config.base_url,
    };

    let cors = match &config.cors_origin {
        Some(origin) => CorsLayer::new()
            .allow_origin(
                origin
                    .parse::<hyper::header::HeaderValue>()
                    .expect("invalid cors origin"),
            )
            .allow_credentials(true)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers(Any),
        None => CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers(Any),
    };

    let api = Router::new()
        .merge(auth::routes())
        .merge(bootstrap::routes())
        .merge(ws::routes());

    let app = Router::new()
        .route("/health", get(health))
        .nest("/api/v1", api)
        .layer(cors)
        .with_state(state);

    let listener = TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .unwrap();
    info!("listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

async fn health() -> &'static str {
    "OK"
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
