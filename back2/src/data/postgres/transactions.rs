use chrono::{DateTime, Utc};
use rustc_hash::{FxHashMap, FxHashSet};
use serde::Serialize;
use sqlx::query;

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
    ) -> Result<(), sqlx::Error> {
        let rows = query!(
            r#"
select
	t.id as id,
	t.date as date,
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
        .fetch_all(&self.pool)
        .await?;

        Ok(())
    }
}

#[derive(Debug, Clone)]
struct Tx {
    id: String,
    date: DateTime<Utc>,
    name: String,
    category: Option<Category>,
    amount: f64,
    links: Vec<String>,
}

#[derive(Debug, Clone)]
struct Category {
    id: String,
    name: String,
    is_neutral: bool,
}

struct TxLink {
    a_id: String,
    b_id: String,
}

fn compute(transactions: Vec<Tx>) -> ComputeResult {
    let mut tx_map: FxHashMap<String, Tx> = FxHashMap::default();
    let mut unique_categories: FxHashSet<String> = FxHashSet::default();

    for tx in transactions {
        tx_map.insert(tx.id.clone(), tx.clone());
        if let Some(cat) = tx.category {
            unique_categories.insert(cat.name);
        }
    }

    println!("{:#?}", tx_map);

    let mut amounts: FxHashMap<String, f64> = FxHashMap::default();
    let mut seen: FxHashSet<String> = FxHashSet::default();

    for tx in tx_map.values() {
        if let Some(cat) = &tx.category {
            if cat.is_neutral {
                continue;
            }
        }

        if tx.amount <= 0.0 {
            continue;
        }
        if seen.get(&tx.id).is_some() {
            continue;
        }

        let mut amount = tx.amount;
        if tx.links.len() <= 0 {
            continue;
        }
        for link in tx.links.iter() {
            if let Some(linked_tx) = tx_map.get(link) {
                if linked_tx.amount > 0.0 {
                    continue;
                }

                let diff = (amount + linked_tx.amount).max(-amount);
                amounts.insert(linked_tx.id.to_owned(), amount);
                amount = amount + linked_tx.amount;
                amounts.insert(tx.id.to_owned(), diff);
            }
        }

        seen.insert(tx.id.to_owned());
    }

    println!("amounts: {:#?}", amounts);

    for (id, amount) in amounts.into_iter() {
        if let Some(tx) = tx_map.get_mut(&id) {
            tx.amount += amount;
        }
    }
    println!("tx: {:#?}", tx_map);

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
    Value(f64),
}

#[derive(Debug, Serialize)]
struct ComputeResult {
    total_pos: f64,
    total_neg: f64,
    categories: Vec<String>,
    data: FxHashMap<String, FxHashMap<String, ChartDataValue>>,
    domain_start: f64,
    domain_end: f64,
}

#[derive(Debug)]
struct TxRow {
    id: String,
    date: DateTime<Utc>,
    amount: f64,
    category_id: Option<String>,
    cat_name: Option<String>,
    cat_is_ne: Option<bool>,

    link_id: Option<String>,

    linked_id: Option<String>,
    linked_amount: Option<f64>,
}

#[cfg(test)]
mod test {
    use std::vec;

    use chrono::{DateTime, Utc};

    use crate::data::{
        create_id,
        postgres::transactions::{Category, TxRow, compute},
    };

    use super::Tx;

    #[test]
    fn test_compute_case_1() {
        let passthrough = Category {
            id: create_id(),
            name: "passthrough".to_owned(),
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

        let result = compute(vec![
            passthrough_credit_1_1.build(),
            passthrough_debit_1_1.build(),
            passthrough_credit_1_2.build(),
        ]);
        println!("result: {:#?}", result);
    }

    fn from_ts(ts: &str) -> DateTime<Utc> {
        return DateTime::parse_from_rfc3339(ts).expect("from_ts").to_utc();
    }

    fn tx(date: DateTime<Utc>, amount: f64, name: &str) -> TxBuilder {
        TxBuilder::new(Tx {
            id: create_id(),
            date,
            name: name.to_owned(),
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
