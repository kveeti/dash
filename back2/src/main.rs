use std::sync::Arc;

use crate::endpoints::*;
use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{delete, get, patch, post},
};
use config::Config;
use data::Data;
use http::{HeaderValue, Method, header};
use state::AppState;
use tokio::{net::TcpListener, signal};
use tower_http::{cors::CorsLayer, limit::RequestBodyLimitLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub mod auth_middleware;
pub mod config;
pub mod data;
pub mod endpoints;
pub mod error;
mod services;
pub mod state;
pub mod statement_parsing;

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

    let transactions = Router::new()
        .route("/stats", get(transactions::get_stats))
        .route("/query", post(transactions::query))
        .route("/", post(transactions::create))
        .route("/bulk", post(transactions::bulk))
        .route(
            "/import/{account_id}/{file_type}",
            post(transactions::import),
        )
        .route("/{id}", patch(transactions::update))
        .route("/{id}", delete(transactions::delete))
        .route("/{id}/linked", post(transactions::link))
        .route("/{id}/linked/{id}", delete(transactions::unlink));

    let categories = Router::new()
        .route("/", get(categories::query).post(categories::create))
        .route(
            "/{id}",
            delete(categories::delete).patch(categories::update),
        );

    let accounts = Router::new().route("/", get(accounts::query).post(accounts::create));

    let user_settings = Router::new().route("/", post(settings::save));

    let auth_base = Router::new()
        .route("/init", get(auth::init))
        .route("/callback", get(auth::callback));

    // dev login in debug mode
    #[cfg(debug_assertions)]
    let auth = auth_base.route("/___dev_login___", post(auth::___dev_login___));
    #[cfg(not(debug_assertions))]
    let auth = auth_base;

    let integrations = Router::new()
        .route("/sync", post(integrations::sync_transactions))
        .nest(
            "/gocardless-nordigen",
            Router::new()
                .route(
                    "/connect-init/{institution_id}",
                    get(integrations::gocardless_nordigen::connect_init),
                )
                .route(
                    "/connect-callback/{institution_id}",
                    get(integrations::gocardless_nordigen::connect_callback),
                ),
        );

    let routes = Router::new()
        .nest("/transactions", transactions)
        .nest("/integrations", integrations)
        .nest("/categories", categories)
        .nest("/accounts", accounts)
        .nest("/settings", user_settings)
        .nest("/auth", auth)
        .route("/@me", get(me::get_me))
        .route("/openapi.json", get(openapi))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(
            250 * 1024 * 1024, /* 250mb */
        ))
        .layer(cors(&config))
        .with_state(state);

    let api = Router::new().nest("/api", routes);

    let listener = TcpListener::bind("0.0.0.0:8000").await.unwrap();
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
