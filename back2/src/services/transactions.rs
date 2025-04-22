use std::collections::{HashMap, HashSet};

use anyhow::Context;
use chrono::{DateTime, Utc};

use crate::{
    data::{Data, Tx},
    endpoints::transactions::get_stats::{Output, OutputDataValue},
};

pub async fn stats(
    data: &Data,
    user_id: &str,
    timezone: &str,
    start: &DateTime<Utc>,
    end: &DateTime<Utc>,
) -> anyhow::Result<Output> {
    let tx_map = data
        .transactions
        .stats(user_id, timezone, start, end)
        .await
        .context("error getting stats")?;

    let result = compute(tx_map);

    return Ok(result);
}

fn compute(mut tx_map: HashMap<String, Tx>) -> Output {
    let mut unique_categories: HashSet<String> = HashSet::default();

    let mut adjustments: HashMap<String, f32> = HashMap::default();

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

    let mut data: HashMap<String, HashMap<String, OutputDataValue>> = HashMap::default();

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
                OutputDataValue::Value(inner) => *inner += tx.amount,
                _ => unreachable!(),
            });
            entry.entry(cat_name).and_modify(|val| match val {
                OutputDataValue::Value(inner) => *inner += tx.amount,
                _ => unreachable!(),
            });
            if tx.amount > 0.0 {
                entry
                    .entry("__total_pos__".into())
                    .and_modify(|val| match val {
                        OutputDataValue::Value(inner) => *inner += tx.amount,
                        _ => unreachable!(),
                    });
            } else {
                entry
                    .entry("__total_neg__".into())
                    .and_modify(|val| match val {
                        OutputDataValue::Value(inner) => *inner += tx.amount,
                        _ => unreachable!(),
                    });
            }
        } else {
            let (neg, pos) = match tx.amount > 0.0 {
                true => (0.0, tx.amount),
                false => (tx.amount, 0.0),
            };

            let mut map = HashMap::default();
            map.insert(
                "__period__".into(),
                OutputDataValue::Period(period.to_owned()),
            );
            map.insert("__total__".into(), OutputDataValue::Value(tx.amount));
            map.insert("__total_neg__".into(), OutputDataValue::Value(neg));
            map.insert("__total_pos__".into(), OutputDataValue::Value(pos));
            map.insert(cat_name.to_owned(), OutputDataValue::Value(tx.amount));

            data.insert(period.clone(), map);
        }
    }

    return Output {
        total_neg,
        total_pos,
        domain_start: 0.0,
        domain_end: 0.0,
        categories: unique_categories.iter().cloned().collect(),
        data,
    };
}

#[cfg(test)]
mod test {
    use std::{collections::HashMap, vec};

    use chrono::{DateTime, Utc};

    use crate::{
        data::{Category, Tx, create_id},
        services::transactions::compute,
    };

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

        let mut tx_map: HashMap<String, Tx> = HashMap::default();
        tx_map.insert(passthrough_credit_1_1.id.to_owned(), passthrough_credit_1_1);
        tx_map.insert(passthrough_credit_1_2.id.to_owned(), passthrough_credit_1_2);
        tx_map.insert(passthrough_debit_1_1.id.to_owned(), passthrough_debit_1_1);
        tx_map.insert(electronics_debit.id.to_owned(), electronics_debit);
        tx_map.insert(electronics_credit.id.to_owned(), electronics_credit);

        let result = compute(tx_map);
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
