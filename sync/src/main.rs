use axum::{Router, http::Method, routing::{get, post}};
use sqlx::{PgPool, migrate};
use state::AppState;
use tokio::{net::TcpListener, signal};
use tower_http::cors::{Any, CorsLayer};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod config;
mod endpoints;
mod error;
mod middleware;
mod state;

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

    // Background compaction: delete tombstoned items older than 30 days
    let compaction_pool = pool.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            interval.tick().await;
            match sqlx::query(
                "DELETE FROM sync_items WHERE is_deleted = TRUE AND tombstoned_at < NOW() - INTERVAL '30 days'"
            )
            .execute(&compaction_pool)
            .await
            {
                Ok(result) => {
                    let count = result.rows_affected();
                    if count > 0 {
                        info!("compaction: deleted {count} tombstoned items");
                    }
                }
                Err(e) => {
                    tracing::error!("compaction failed: {e}");
                }
            }
        }
    });

    let state = AppState {
        pool,
        jwt_secret: config.jwt_secret,
    };

    let cors = match &config.cors_origin {
        Some(origin) => CorsLayer::new()
            .allow_origin(
                origin
                    .parse::<hyper::header::HeaderValue>()
                    .expect("invalid cors origin"),
            )
            .allow_methods([Method::GET, Method::POST])
            .allow_headers(Any),
        None => CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers(Any),
    };

    let app = Router::new()
        .route("/health", get(health))
        // Auth (unauthenticated)
        .route("/auth/signup", post(endpoints::auth::signup))
        .route("/auth/salt/{user_id}", get(endpoints::auth::get_salt))
        .route("/auth/login", post(endpoints::auth::login))
        // Sync (authenticated via AuthUser extractor)
        .route("/sync/handshake", get(endpoints::sync::handshake))
        .route("/sync/pull", get(endpoints::sync::pull))
        .route("/sync/push", post(endpoints::sync::push))
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
