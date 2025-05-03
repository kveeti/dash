pub mod get_stats;
pub use get_stats::get_stats;

pub mod create;
pub use create::create;

pub mod update;
pub use update::update;

pub mod delete;
pub use delete::delete;

pub mod links;
pub use links::link;
pub use links::unlink;

pub mod query;
pub use query::query;

// pub async fn query() -> Result<impl IntoResponse, ApiError> {
//     Ok(())
// }
//
// pub async fn create() -> Result<impl IntoResponse, ApiError> {
//     Ok(())
// }
//
// pub async fn update() -> Result<impl IntoResponse, ApiError> {
//     Ok(())
// }
//
// pub async fn delete() -> Result<impl IntoResponse, ApiError> {
//     Ok(())
// }
//
// pub async fn link() -> Result<impl IntoResponse, ApiError> {
//     Ok(())
// }
//
// pub async fn unlink() -> Result<impl IntoResponse, ApiError> {
//     Ok(())
// }
