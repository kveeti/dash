use axum::{
    Router,
    extract::Request,
    http::header::{self, HeaderName, HeaderValue},
    middleware::{self, Next},
    response::Response,
};
use tower_http::services::{ServeDir, ServeFile};

pub fn router(dir: &str) -> Router {
    let index_file = format!("{dir}/index.html");

    Router::new()
        .fallback_service(ServeDir::new(dir).fallback(ServeFile::new(&index_file)))
        .layer(middleware::from_fn(add_headers))
}

async fn add_headers(request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let cache_policy = cache_policy_for_path(path);

    let mut response = next.run(request).await;
    let headers = response.headers_mut();

    headers.insert(header::X_FRAME_OPTIONS, SAMEORIGIN.clone());
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, NOSNIFF.clone());
    headers.insert(header::REFERRER_POLICY, STRICT_ORIGIN.clone());
    headers.insert(header::REFERRER_POLICY, STRICT_ORIGIN.clone());
    headers.insert(header::CONTENT_SECURITY_POLICY, CSP.clone());
    headers.insert(PERMISSIONS_POLICY.clone(), PERMISSIONS.clone());
    headers.insert(COOP.clone(), SAME_ORIGIN.clone());
    headers.insert(CORP.clone(), SAME_ORIGIN.clone());
    headers.insert(COEP.clone(), REQUIRE_CORP.clone());
    headers.insert(header::X_DNS_PREFETCH_CONTROL, OFF.clone());
    headers.insert(CROSS_DOMAIN_POLICIES.clone(), NONE.clone());

    match cache_policy {
        CachePolicy::NoStore => {
            headers.insert(header::CACHE_CONTROL, NO_CACHE.clone());
            headers.insert(header::PRAGMA, NO_CACHE_PRAGMA.clone());
            headers.insert(header::EXPIRES, EXPIRES_ZERO.clone());
        }
        CachePolicy::Immutable => {
            headers.insert(header::CACHE_CONTROL, IMMUTABLE.clone());
        }
        CachePolicy::Default => {}
    }

    response
}

#[derive(Clone, Copy)]
enum CachePolicy {
    NoStore,
    Immutable,
    Default,
}

fn cache_policy_for_path(path: &str) -> CachePolicy {
    if path.ends_with("sw.js") {
        return CachePolicy::NoStore;
    }

    let Some(dot_pos) = path.rfind('.') else {
        return CachePolicy::Default;
    };
    let ext = &path[dot_pos..];

    match ext {
        ".js" | ".css" | ".woff" | ".woff2" | ".ttf" | ".eot" | ".png" | ".jpg" | ".jpeg"
        | ".gif" | ".ico" | ".svg" => CachePolicy::Immutable,
        _ => CachePolicy::Default,
    }
}

static SAMEORIGIN: HeaderValue = HeaderValue::from_static("SAMEORIGIN");
static NOSNIFF: HeaderValue = HeaderValue::from_static("nosniff");
static STRICT_ORIGIN: HeaderValue = HeaderValue::from_static("strict-origin-when-cross-origin");
static CSP: HeaderValue = HeaderValue::from_static(
    "default-src 'self'; script-src 'self' 'sha256-zInxbYa07u4RtG3oSgrGKxUxNV9ZGQMiulumMKzfe9g=' 'sha256-DC38JSrByNp2h1owUc53/dTOpx5MuvD3dU2mE2RrSVo='; style-src 'self' 'sha256-Fh6PFm+zxcAOSVK2iEQRK6/Ooss+yXwZCSZzO84zAiw='; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self';",
);
static PERMISSIONS_POLICY: HeaderName = HeaderName::from_static("permissions-policy");
static PERMISSIONS: HeaderValue =
    HeaderValue::from_static("camera=(), microphone=(), geolocation=()");
static COOP: HeaderName = HeaderName::from_static("cross-origin-opener-policy");
static CORP: HeaderName = HeaderName::from_static("cross-origin-resource-policy");
static COEP: HeaderName = HeaderName::from_static("cross-origin-embedder-policy");
static CROSS_DOMAIN_POLICIES: HeaderName =
    HeaderName::from_static("x-permitted-cross-domain-policies");
static SAME_ORIGIN: HeaderValue = HeaderValue::from_static("same-origin");
static REQUIRE_CORP: HeaderValue = HeaderValue::from_static("require-corp");
static OFF: HeaderValue = HeaderValue::from_static("off");
static NONE: HeaderValue = HeaderValue::from_static("none");
static NO_CACHE: HeaderValue = HeaderValue::from_static("no-cache, no-store, must-revalidate");
static NO_CACHE_PRAGMA: HeaderValue = HeaderValue::from_static("no-cache");
static EXPIRES_ZERO: HeaderValue = HeaderValue::from_static("0");
static IMMUTABLE: HeaderValue = HeaderValue::from_static("public, max-age=31536000, immutable");
