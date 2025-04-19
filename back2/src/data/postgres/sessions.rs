use sqlx::query_as;

use super::Pool;

#[derive(Clone)]
pub struct Sessions {
    pool: Pool,
}

impl Sessions {
    pub(crate) fn new(pool: Pool) -> Self {
        return Self { pool };
    }

    pub async fn get_one(
        &self,
        user_id: &str,
        session_id: &str,
    ) -> Result<Option<Session>, sqlx::Error> {
        let session = query_as!(
            Session,
            "select id, user_id from sessions where id = $1 and user_id = $2 limit 1;",
            session_id,
            user_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        return Ok(session);
    }
}

pub struct Session {
    pub id: String,
    pub user_id: String,
}
