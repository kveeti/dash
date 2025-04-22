use std::collections::HashMap;

use chrono::{DateTime, Utc};
use futures::TryStreamExt;
use sqlx::{prelude::FromRow, query_as};

use super::Pool;

#[derive(Clone)]
pub struct Transactions {
    pool: Pool,
}

impl Transactions {
    pub(crate) fn new(pool: Pool) -> Self {
        return Self { pool };
    }

    pub async fn stats(
        &self,
        user_id: &str,
        timezone: &str,
        start: &DateTime<Utc>,
        end: &DateTime<Utc>,
    ) -> Result<HashMap<String, Tx>, sqlx::Error> {
        let mut rows = query_as!(
            TxRow,
            r#"
select
	t.id as id,
	t.date as date,
	t.counter_party as counter_party,
	t.amount as amount,
	t.category_id as category_id,
	c.name as cat_name,
	c.is_neutral as cat_is_ne,

	link.id as link_id, 
	linked.id as linked_id,
	linked.amount as linked_amount
from transactions t
left join transactions_links link on link.transaction_a_id = t.id or link.transaction_b_id = t.id
left join transactions linked on (
	link.transaction_b_id = linked.id and link.transaction_a_id = t.id
) or (
	link.transaction_a_id = linked.id and link.transaction_b_id = t.id
)

-- left join transactions_links link
--   on link.transaction_a_id = t.id or link.transaction_b_id = t.id
-- left join transactions linked
--   on (linked.id = CASE WHEN link.transaction_a_id = t.id THEN link.transaction_b_id ELSE link.transaction_a_id END)

left join transaction_categories c on t.category_id = c.id
where t.user_id = $1
and t.date at time zone $2 between $3 and $4;
        "#,
            user_id,
            timezone,
            start.naive_utc(),
            end.naive_utc()
        )
        .fetch(&self.pool);

        let mut tx_map: HashMap<String, Tx> = HashMap::default();

        while let Some(row) = rows.try_next().await? {
            let tx = tx_map.get_mut(&row.id);

            if let Some(tx) = tx {
                if let Some(linked_id) = row.linked_id {
                    tx.links.push(linked_id);
                }
            } else {
                tx_map.insert(
                    row.id.to_owned(),
                    Tx {
                        id: row.id,
                        date: row.date,
                        counter_party: row.counter_party,
                        amount: row.amount,
                        links: vec![],
                        category: if let Some(cat_id) = row.category_id {
                            Some(Category {
                                id: cat_id,
                                name: row.cat_name.expect("checked cat_name"),
                                is_neutral: row.cat_is_ne.expect("checked is_ne"),
                            })
                        } else {
                            None
                        },
                    },
                );
            }
        }

        return Ok(tx_map);
    }
}

#[derive(Debug, FromRow)]
struct TxRow {
    id: String,
    date: DateTime<Utc>,
    amount: f32,
    counter_party: String,
    category_id: Option<String>,
    cat_name: Option<String>,
    cat_is_ne: Option<bool>,

    link_id: Option<String>,

    linked_id: Option<String>,
    linked_amount: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct Tx {
    pub id: String,
    pub date: DateTime<Utc>,
    pub counter_party: String,
    pub category: Option<Category>,
    pub amount: f32,
    pub links: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub is_neutral: bool,
}
