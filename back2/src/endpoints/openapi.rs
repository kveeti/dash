use crate::endpoints;
use axum::Json;
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(paths(
    endpoints::auth::init,
    endpoints::auth::callback,
    endpoints::me::get_me,
    endpoints::transactions::get_stats::get_stats,
))]
struct ApiDoc;

pub async fn openapi() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}
