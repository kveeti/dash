use crate::data::{Category, Data};

pub async fn query(
    data: &Data,
    user_id: &str,
    search_text: &Option<String>,
) -> anyhow::Result<Vec<Category>> {
    let categories = data.query_categories(user_id, search_text).await?;

    Ok(categories)
}
