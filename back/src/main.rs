use std::{sync::Arc, time::Duration};

use crate::endpoints::*;
use auth_middleware::csrf_middleware;
use axum::{
    Router,
    extract::{DefaultBodyLimit, MatchedPath, Request},
    middleware::{self, Next},
    response::Response,
    routing::{delete, get, patch, post},
};

use config::Config;
use data::{Data, do_pending_imports};
use error::ApiError;
use http::{
    HeaderName, HeaderValue, Method,
    header::{self, USER_AGENT},
};
use opentelemetry::{
    KeyValue,
    global::{self},
    trace::{Span, Tracer, TracerProvider as _},
};
use opentelemetry_otlp::{Protocol, SpanExporter, WithExportConfig};
use opentelemetry_sdk::{
    Resource,
    propagation::TraceContextPropagator,
    trace::{Sampler, SdkTracerProvider},
};
use opentelemetry_semantic_conventions::{
    attribute::OTEL_STATUS_CODE,
    trace::{
        HTTP_REQUEST_METHOD, HTTP_RESPONSE_STATUS_CODE, HTTP_ROUTE, NETWORK_PROTOCOL_VERSION,
        URL_FULL, USER_AGENT_ORIGINAL,
    },
};
use state::AppState;
use tokio::{net::TcpListener, signal};
use tower_http::{cors::CorsLayer, limit::RequestBodyLimitLayer, trace::TraceLayer};
use tracing::field::Empty;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub mod auth_middleware;
pub mod config;
pub mod data;
pub mod endpoints;
pub mod error;
pub mod state;
pub mod statement_parsing;

#[tokio::main]
async fn main() {
    let service_name = env!("CARGO_CRATE_NAME");

    global::set_text_map_propagator(TraceContextPropagator::new());
    let exporter = SpanExporter::builder()
        .with_tonic()
        .with_timeout(Duration::from_secs(3))
        .build()
        .expect("error creating trace exporter");

    let tracer_provider = SdkTracerProvider::builder()
        .with_resource(Resource::builder().with_service_name(service_name).build())
        .with_batch_exporter(exporter)
        .with_sampler(Sampler::TraceIdRatioBased(0.5))
        .build();

    let tracer = tracer_provider.tracer(service_name);
    let otel_layer = OpenTelemetryLayer::new(tracer).with_location(false);

    global::set_tracer_provider(tracer_provider.clone());

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                format!("{service_name}=debug,tower_http=info,sqlx=info,axum::rejection=trace",)
                    .into()
            }),
        )
        .with(otel_layer)
        .with(
            tracing_subscriber::fmt::layer()
                .with_line_number(false)
                .with_file(false),
        )
        .init();

    let config = Arc::new(Config::new().expect("config"));
    let data = Data::new(&config).await.expect("data");
    let state = AppState {
        config: config.clone(),
        data,
    };

    let state_for_pending = state.clone();
    tokio::spawn(async move {
        let _ = do_pending_imports(&state_for_pending).await;
    });

    let v1_transactions = Router::new()
        .route("/stats", get(transactions::stats))
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

    let v1_categories = Router::new()
        .route("/", get(categories::query).post(categories::create))
        .route(
            "/{id}",
            delete(categories::delete).patch(categories::update),
        );

    let v1_accounts = Router::new().route("/", get(accounts::query).post(accounts::create));

    let v1_user_settings = Router::new().route("/", post(settings::save));

    let v1_auth_base = Router::new()
        .route("/init", get(auth::init))
        .route("/callback", get(auth::callback))
        .route("/logout", get(auth::logout));

    // dev login in debug mode
    #[cfg(debug_assertions)]
    let v1_auth = v1_auth_base.route("/___dev_login___", post(auth::___dev_login___));
    #[cfg(not(debug_assertions))]
    let v1_auth = v1_auth_base;

    let v1_integrations = Router::new()
        .route("/sync", post(integrations::sync::sync))
        .route("/", get(integrations::get::get))
        .route("/{integration_name}", delete(integrations::delete::delete))
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
    let v1 = Router::new()
        .nest("/transactions", v1_transactions)
        .nest("/integrations", v1_integrations)
        .nest("/categories", v1_categories)
        .nest("/accounts", v1_accounts)
        .nest("/settings", v1_user_settings)
        .nest("/auth", v1_auth)
        .route("/@me", get(me::get_me))
        .route("/openapi.json", get(openapi));

    let routes = Router::new()
        .nest("/v1", v1)
        .route("/health", get(health_check))
        .route("/fail", get(failing_endpoint))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(
            250 * 1024 * 1024, /* 250mb */
        ))
        .layer(middleware::from_fn(csrf_middleware))
        .layer(cors(&config))
        .with_state(state)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|request: &http::Request<axum::body::Body>| {
                    let matched_path = request
                        .extensions()
                        .get::<MatchedPath>()
                        .map(MatchedPath::as_str)
                        .unwrap_or("{unknown}");

                    tracing::info_span!(
                        "request",
                        otel.name = format!("{} {}", request.method(), matched_path),
                        { OTEL_STATUS_CODE } = Empty,
                        { HTTP_REQUEST_METHOD } = ?request.method(),
                        { HTTP_ROUTE } = %request.uri().path(),
                        { URL_FULL } = %request.uri().path(),
                        { NETWORK_PROTOCOL_VERSION } = ?request.version(),
                        { USER_AGENT_ORIGINAL } = %request.headers().get(USER_AGENT).and_then(|h| h.to_str().ok()).unwrap_or_default()
                    )
                })
                .on_response(|response: &Response, _latency: Duration, span: &tracing::Span| {
                    let status_code = response.status().as_u16();
                    let is_failure = if status_code < 300 { "ok" } else { "error" };
                    span.record(OTEL_STATUS_CODE, is_failure);
                    span.record(HTTP_RESPONSE_STATUS_CODE, status_code);
                })
                .on_failure(|_, _, span: &tracing::Span| {
                    span.record(OTEL_STATUS_CODE, "error");
                })
        );

    let api = Router::new().nest("/api", routes);

    let listener = TcpListener::bind("0.0.0.0:8000").await.unwrap();
    tracing::debug!("listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, api)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

pub async fn tracer_middleware(request: Request, next: Next) -> Result<Response, ApiError> {
    let tracer = global::tracer("backend");

    let method = request.method().clone();
    let uri = request.uri().clone();
    let mut span = tracer
        .span_builder("req")
        .with_attributes(vec![
            KeyValue::new("http.method", method.to_string()),
            KeyValue::new("http.uri", uri.to_string()),
        ])
        .start(&tracer);

    let res = next.run(request).await;
    let status = res.status().clone();

    span.set_status(opentelemetry::trace::Status::Ok);
    span.set_attribute(KeyValue::new("http.status", status.to_string()));
    span.end();

    Ok(res)
}

#[tracing::instrument(skip(config))]
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
            "x-csrf".parse::<HeaderName>().expect("x-csrf header"),
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

async fn health_check() -> &'static str {
    "OK"
}

async fn failing_endpoint() -> &'static str {
    panic!("oh no");

    "OK"
}
