use chrono::{DateTime, Utc};
use futures::TryStreamExt;
use rustc_hash::{FxHashMap, FxHashSet};
use serde::Serialize;
use sqlx::{prelude::FromRow, query_as};

use super::Pool;

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
        timezone: String,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<ComputeResult, sqlx::Error> {
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
and t.date at time zone $2 between $3 and $4
and c.is_neutral = false;
        "#,
            user_id,
            timezone,
            start.naive_utc(),
            end.naive_utc()
        )
        .fetch(&self.pool);

        let mut tx_map: FxHashMap<String, Tx> = FxHashMap::default();

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

        let result = compute(tx_map);

        return Ok(result);
    }
}

#[derive(Debug, Clone)]
struct Tx {
    id: String,
    date: DateTime<Utc>,
    counter_party: String,
    category: Option<Category>,
    amount: f32,
    links: Vec<String>,
}

#[derive(Debug, Clone)]
struct Category {
    id: String,
    name: String,
    is_neutral: bool,
}

fn compute(mut tx_map: FxHashMap<String, Tx>) -> ComputeResult {
    let mut unique_categories: FxHashSet<String> = FxHashSet::default();

    let mut adjustments: FxHashMap<String, f32> = FxHashMap::default();

    for tx in tx_map.values() {
        if tx.amount <= 0.0 || tx.links.is_empty() {
            continue;
        }
        if let Some(cat) = &tx.category {
            if cat.is_neutral {
                continue;
            }
        }

        if let Some(cat) = &tx.category {
            unique_categories.insert(cat.name.to_owned());
        }

        let mut remaining_amount = tx.amount;

        for link_id in &tx.links {
            if let Some(linked_tx) = tx_map.get(link_id) {
                if linked_tx.amount >= 0.0 {
                    continue;
                }

                let linked_abs = linked_tx.amount.abs();
                let amount_to_use = remaining_amount.min(linked_abs);

                if amount_to_use > 0.0 {
                    *adjustments.entry(tx.id.clone()).or_default() -= amount_to_use;
                    *adjustments.entry(link_id.clone()).or_default() += amount_to_use;

                    remaining_amount -= amount_to_use;

                    if remaining_amount <= 0.0 {
                        break;
                    }
                }
            }
        }
    }

    for (id, adjustment) in adjustments {
        if let Some(tx) = tx_map.get_mut(&id) {
            tx.amount += adjustment;
        }
    }

    let mut data: FxHashMap<String, FxHashMap<String, ChartDataValue>> = FxHashMap::default();

    let mut total_neg = 0.0;
    let mut total_pos = 0.0;

    for tx in tx_map.values() {
        if tx.amount == 0.0 {
            continue;
        }

        let cat_name = tx
            .category
            .as_ref()
            .map(|c| c.name.to_owned())
            .unwrap_or("__uncategorized__".into());

        let period = tx.date.format("%Y-%m").to_string();

        if tx.amount > 0.0 {
            total_pos += tx.amount;
        } else {
            total_neg += tx.amount;
        }

        if let Some(entry) = data.get_mut(&period) {
            entry.entry("__total__".into()).and_modify(|val| match val {
                ChartDataValue::Value(inner) => *inner += tx.amount,
                _ => unreachable!(),
            });
            entry.entry(cat_name).and_modify(|val| match val {
                ChartDataValue::Value(inner) => *inner += tx.amount,
                _ => unreachable!(),
            });
            if tx.amount > 0.0 {
                entry
                    .entry("__total_pos__".into())
                    .and_modify(|val| match val {
                        ChartDataValue::Value(inner) => *inner += tx.amount,
                        _ => unreachable!(),
                    });
            } else {
                entry
                    .entry("__total_neg__".into())
                    .and_modify(|val| match val {
                        ChartDataValue::Value(inner) => *inner += tx.amount,
                        _ => unreachable!(),
                    });
            }
        } else {
            let (neg, pos) = match tx.amount > 0.0 {
                true => (0.0, tx.amount),
                false => (tx.amount, 0.0),
            };

            let mut map = FxHashMap::default();
            map.insert(
                "__period__".into(),
                ChartDataValue::Period(period.to_owned()),
            );
            map.insert("__total__".into(), ChartDataValue::Value(tx.amount));
            map.insert("__total_neg__".into(), ChartDataValue::Value(neg));
            map.insert("__total_pos__".into(), ChartDataValue::Value(pos));
            map.insert(cat_name.to_owned(), ChartDataValue::Value(tx.amount));

            data.insert(period.clone(), map);
        }
    }

    return ComputeResult {
        total_neg,
        total_pos,
        domain_start: 0.0,
        domain_end: 0.0,
        categories: unique_categories.iter().cloned().collect(),
        data,
    };
}

#[derive(Debug, Serialize)]
enum ChartDataValue {
    Period(String),
    Value(f32),
}

#[derive(Debug, Serialize)]
struct ComputeResult {
    total_pos: f32,
    total_neg: f32,
    categories: Vec<String>,
    data: FxHashMap<String, FxHashMap<String, ChartDataValue>>,
    domain_start: f32,
    domain_end: f32,
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

#[cfg(test)]
mod test {
    use std::vec;

    use chrono::{DateTime, Utc};
    use rustc_hash::FxHashMap;

    use crate::data::{
        create_id,
        postgres::transactions::{Category, compute},
    };

    use super::Tx;

    #[test]
    fn test_compute_case_1() {
        let passthrough = Category {
            id: create_id(),
            name: "passthrough".to_owned(),
            is_neutral: false,
        };

        let electronics = Category {
            id: create_id(),
            name: "electronics".to_owned(),
            is_neutral: false,
        };

        let passthrough_credit_1_1 =
            tx(from_ts("2025-01-03T12:00:00Z"), 15.0, "credit_1_1").cat(&passthrough);
        let passthrough_credit_1_2 =
            tx(from_ts("2025-01-28T12:00:00Z"), 20.0, "credit_1_2").cat(&passthrough);
        let passthrough_debit_1_1 =
            tx(from_ts("2025-01-15T12:00:00Z"), -32.3, "debit_1").cat(&passthrough);

        let passthrough_credit_1_1 = passthrough_credit_1_1.linkb(&passthrough_debit_1_1);
        let passthrough_credit_1_2 = passthrough_credit_1_2.linkb(&passthrough_debit_1_1);
        let passthrough_debit_1_1 = passthrough_debit_1_1
            .linkb(&passthrough_credit_1_1)
            .linkb(&passthrough_credit_1_2);

        let passthrough_credit_1_1 = passthrough_credit_1_1.build();
        let passthrough_credit_1_2 = passthrough_credit_1_2.build();
        let passthrough_debit_1_1 = passthrough_debit_1_1.build();

        let electronics_debit =
            tx(from_ts("2025-01-01T12:00:00Z"), -150.0, "electronics_debit").cat(&electronics);
        let electronics_credit =
            tx(from_ts("2025-02-01T12:00:00Z"), 150.0, "electronics_credit").cat(&electronics);

        let electronics_debit = electronics_debit.linkb(&electronics_credit).build();
        let electronics_credit = electronics_credit.link(&electronics_debit).build();

        let mut tx_map: FxHashMap<String, Tx> = FxHashMap::default();
        tx_map.insert(passthrough_credit_1_1.id.to_owned(), passthrough_credit_1_1);
        tx_map.insert(passthrough_credit_1_2.id.to_owned(), passthrough_credit_1_2);
        tx_map.insert(passthrough_debit_1_1.id.to_owned(), passthrough_debit_1_1);
        tx_map.insert(electronics_debit.id.to_owned(), electronics_debit);
        tx_map.insert(electronics_credit.id.to_owned(), electronics_credit);

        let result = compute(tx_map);
        println!("result: {:#?}", result);
    }

    fn from_ts(ts: &str) -> DateTime<Utc> {
        return DateTime::parse_from_rfc3339(ts).expect("from_ts").to_utc();
    }

    fn tx(date: DateTime<Utc>, amount: f32, name: &str) -> TxBuilder {
        TxBuilder::new(Tx {
            id: create_id(),
            date,
            counter_party: name.to_owned(),
            amount,
            links: vec![],
            category: None,
        })
    }

    struct TxBuilder {
        value: Tx,
    }

    impl TxBuilder {
        pub fn new(tx: Tx) -> Self {
            return Self { value: tx };
        }

        fn cat(mut self, cat: &Category) -> Self {
            self.value.category = Some(cat.to_owned());

            self
        }

        fn link(mut self, linked_tx: &Tx) -> Self {
            self.value.links.push(linked_tx.id.to_owned());

            self
        }

        fn linkb(mut self, linked_tx: &TxBuilder) -> Self {
            self.value.links.push(linked_tx.value.id.to_owned());

            self
        }

        fn build(self) -> Tx {
            return self.value;
        }
    }
}
