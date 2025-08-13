#[cfg(feature = "docs")]
pub mod openapi {
    use crate::endpoints;
    use axum::Json;
    use utoipa::OpenApi;

    #[derive(utoipa::OpenApi)]
    #[openapi(paths(
        endpoints::auth::init,
        endpoints::auth::callback,
        endpoints::auth::logout,
        endpoints::me::get_me,
        endpoints::transactions::stats::get_stats,
        endpoints::transactions::query::query,
        endpoints::transactions::create::create,
        endpoints::transactions::update::update,
        endpoints::transactions::delete::delete,
        endpoints::transactions::links::link,
        endpoints::transactions::links::unlink,
        endpoints::transactions::bulk::bulk,
        endpoints::categories::query::query,
        endpoints::categories::create::create,
        endpoints::categories::update::update,
        endpoints::categories::delete::delete,
        endpoints::accounts::query::query,
        endpoints::accounts::create::create,
        endpoints::settings::save,
        endpoints::integrations::get::get,
        endpoints::integrations::sync::sync,
        endpoints::integrations::delete::delete
    ))]
    struct ApiDoc;

    pub async fn openapi() -> Json<utoipa::openapi::OpenApi> {
        Json(ApiDoc::openapi())
    }
}
