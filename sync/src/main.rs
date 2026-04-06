use axum::{
    Router,
    extract::{Path, Query, State},
    http::Method,
    response::IntoResponse,
    routing::{get, post},
};
use base64::Engine;
use hyper::StatusCode;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row, migrate};
use state::AppState;
use tokio::{net::TcpListener, signal};
use tower_http::cors::{Any, CorsLayer};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod config;
mod error;
mod state;

use error::ApiError;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sync=debug,tower_http=info,sqlx=info".into()),
        )
        .with(tracing_subscriber::fmt::layer()
            .with_line_number(cfg!(debug_assertions))
            .with_file(cfg!(debug_assertions))
            .with_target(cfg!(debug_assertions)))
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

    let state = AppState { pool };

    let cors = match &config.cors_origin {
        Some(origin) => CorsLayer::new()
            .allow_origin(origin.parse::<hyper::header::HeaderValue>().expect("invalid cors origin"))
            .allow_methods([Method::GET, Method::POST])
            .allow_headers(Any),
        None => CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers(Any),
    };

    let app = Router::new()
        .route("/sync/{sync_id}/push", post(push))
        .route("/sync/{sync_id}/pull", get(pull))
        .route("/sync/{sync_id}/version", get(version))
        .route("/sync/{sync_id}/snapshot", get(snapshot_get).post(snapshot_push))
        .route("/health", get(health))
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

#[derive(Serialize)]
struct PushResponse {
    version: i64,
}

async fn push(
    State(state): State<AppState>,
    Path(sync_id): Path<String>,
    body: axum::body::Bytes,
) -> Result<impl IntoResponse, ApiError> {
    if body.is_empty() {
        return Err(ApiError::BadRequest("empty body".to_string()));
    }

    let version: i64 = sqlx::query_scalar(
        "INSERT INTO changesets (sync_id, data) VALUES ($1, $2) RETURNING version",
    )
    .bind(&sync_id)
    .bind(body.as_ref())
    .fetch_one(&state.pool)
    .await?;

    Ok((StatusCode::OK, axum::Json(PushResponse { version })))
}

#[derive(Deserialize)]
struct PullQuery {
    after: i64,
    limit: Option<i64>,
}

#[derive(Serialize)]
struct Changeset {
    version: i64,
    data: String, // base64
}

async fn pull(
    State(state): State<AppState>,
    Path(sync_id): Path<String>,
    Query(query): Query<PullQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let limit = query.limit.unwrap_or(100).min(500);

    let rows = sqlx::query(
        "SELECT version, data FROM changesets WHERE sync_id = $1 AND version > $2 ORDER BY version LIMIT $3",
    )
    .bind(&sync_id)
    .bind(query.after)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    let changesets: Vec<Changeset> = rows
        .iter()
        .map(|row| {
            let version: i64 = row.get("version");
            let data: Vec<u8> = row.get("data");
            Changeset {
                version,
                data: base64::engine::general_purpose::STANDARD.encode(&data),
            }
        })
        .collect();

    Ok(axum::Json(changesets))
}

#[derive(Serialize)]
struct VersionResponse {
    version: i64,
    snapshot_version: i64,
    snapshot_at: Option<String>,
}

async fn version(
    State(state): State<AppState>,
    Path(sync_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let version: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(version) FROM changesets WHERE sync_id = $1",
    )
    .bind(&sync_id)
    .fetch_one(&state.pool)
    .await?;

    let snapshot = sqlx::query("SELECT version, created_at FROM snapshots WHERE sync_id = $1")
        .bind(&sync_id)
        .fetch_optional(&state.pool)
        .await?;

    let (snapshot_version, snapshot_at) = match snapshot {
        Some(row) => {
            let v: i64 = row.get("version");
            let at: chrono::DateTime<chrono::Utc> = row.get("created_at");
            (v, Some(at.to_rfc3339()))
        }
        None => (0, None),
    };

    // version must be at least snapshot_version (snapshot covers those changesets)
    let version = version.unwrap_or(0).max(snapshot_version);

    Ok(axum::Json(VersionResponse {
        version,
        snapshot_version,
        snapshot_at,
    }))
}

#[derive(Serialize)]
struct SnapshotPushResponse {
    snapshot_version: i64,
    compacted: i64,
}

async fn snapshot_push(
    State(state): State<AppState>,
    Path(sync_id): Path<String>,
    body: axum::body::Bytes,
) -> Result<impl IntoResponse, ApiError> {
    if body.is_empty() {
        return Err(ApiError::BadRequest("empty body".to_string()));
    }

    // The snapshot covers everything up to the current max version
    let current_version: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(version) FROM changesets WHERE sync_id = $1",
    )
    .bind(&sync_id)
    .fetch_one(&state.pool)
    .await?;

    // Also check existing snapshot version
    let existing_snapshot_version: Option<i64> = sqlx::query_scalar(
        "SELECT version FROM snapshots WHERE sync_id = $1",
    )
    .bind(&sync_id)
    .fetch_optional(&state.pool)
    .await?;

    let snapshot_version = current_version
        .unwrap_or(0)
        .max(existing_snapshot_version.unwrap_or(0));

    // Upsert snapshot
    sqlx::query(
        "INSERT INTO snapshots (sync_id, version, data) VALUES ($1, $2, $3)
         ON CONFLICT (sync_id) DO UPDATE SET version = $2, data = $3, created_at = now()",
    )
    .bind(&sync_id)
    .bind(snapshot_version)
    .bind(body.as_ref())
    .execute(&state.pool)
    .await?;

    // Compact: delete changesets covered by the snapshot
    let result = sqlx::query(
        "DELETE FROM changesets WHERE sync_id = $1 AND version <= $2",
    )
    .bind(&sync_id)
    .bind(snapshot_version)
    .execute(&state.pool)
    .await?;

    info!(
        sync_id = %sync_id,
        snapshot_version = snapshot_version,
        compacted = result.rows_affected(),
        "snapshot uploaded"
    );

    Ok((StatusCode::OK, axum::Json(SnapshotPushResponse {
        snapshot_version,
        compacted: result.rows_affected() as i64,
    })))
}

async fn snapshot_get(
    State(state): State<AppState>,
    Path(sync_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let row = sqlx::query("SELECT version, data FROM snapshots WHERE sync_id = $1")
        .bind(&sync_id)
        .fetch_optional(&state.pool)
        .await?;

    match row {
        Some(row) => {
            let version: i64 = row.get("version");
            let data: Vec<u8> = row.get("data");
            Ok((
                StatusCode::OK,
                [("x-snapshot-version", version.to_string())],
                data,
            ))
        }
        None => Err(ApiError::NotFound("no snapshot".to_string())),
    }
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
