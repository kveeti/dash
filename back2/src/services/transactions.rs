use std::collections::HashMap;

use anyhow::Context;
use chrono::{DateTime, Utc};

use crate::{
    data::{Data, Tx},
    endpoints::{self},
    error::ApiError,
};

pub async fn create(
    data: &Data,
    user_id: &str,
    input: &endpoints::transactions::create::CreateTransactionInput,
) -> anyhow::Result<()> {
    // let tx = InsertTx {
    //     id: create_id(),
    //     amount: input.amount,
    //     counter_party: input.counter_party.to_owned(),
    //     date: input.date,
    //     additional: input.additional.to_owned(),
    //     currency: "EUR".to_owned(),
    // };
    //
    // if let Some(category_name) = &input.category_name {
    //     data.transactions
    //         .insert_with_category_and_account(&user_id, &tx, category_name, &input.account_name)
    //         .await?;
    // } else {
    //     data.transactions
    //         .insert_with_account(&user_id, &tx, &input.account_name)
    //         .await?;
    // }

    Ok(())
}

pub async fn delete(data: &Data, user_id: &str, tx_id: &str) -> anyhow::Result<()> {
    data.delete_tx(user_id, tx_id).await?;

    Ok(())
}

pub async fn link(data: &Data, user_id: &str, tx1_id: &str, tx2_id: &str) -> Result<(), ApiError> {
    if tx1_id == tx2_id {
        return Err(ApiError::BadRequest("Cannot link to itself".into()));
    }

    data.link_tx(user_id, tx1_id, tx2_id)
        .await
        .context("error creating link")?;

    Ok(())
}

pub async fn unlink(
    data: &Data,
    user_id: &str,
    tx1_id: &str,
    tx2_id: &str,
) -> Result<(), ApiError> {
    if tx1_id == tx2_id {
        return Err(ApiError::BadRequest("Cannot unlink self".into()));
    }

    data.unlink_tx(user_id, tx1_id, tx2_id)
        .await
        .context("error unlinking")?;

    Ok(())
}

pub async fn stats(
    data: &Data,
    user_id: &str,
    timezone: &str,
    start: &DateTime<Utc>,
    end: &DateTime<Utc>,
) -> anyhow::Result<endpoints::transactions::get_stats::Output> {
    let tx_map = data
        .tx_stats(user_id, timezone, start, end)
        .await
        .context("error getting stats")?;

    let result = compute(tx_map);

    return Ok(result);
}

fn compute(mut tx_map: HashMap<String, Tx>) -> endpoints::transactions::get_stats::Output {
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

    let mut dates: Vec<String> = Vec::new();
    let mut i_cats: Vec<Vec<String>> = Vec::new();
    let mut i: Vec<Vec<f32>> = Vec::new();
    let mut e_cats: Vec<Vec<String>> = Vec::new();
    let mut e: Vec<Vec<f32>> = Vec::new();

    let mut total_income: f32 = 0.0;
    let mut total_expenses: f32 = 0.0;

    let mut period_txs: HashMap<String, Vec<&Tx>> = HashMap::new();
    for tx in tx_map.values() {
        if tx.amount == 0.0 {
            continue;
        }
        let period = tx.date.format("%Y-%m").to_string();
        period_txs.entry(period).or_default().push(tx);
    }

    let mut periods: Vec<String> = period_txs.keys().cloned().collect();
    periods.sort();

    let mut tti: Vec<f32> = vec![0.0; periods.len()];
    let mut tte: Vec<f32> = vec![0.0; periods.len()];

    for (period_index, period) in periods.iter().enumerate() {
        dates.push(period.clone());

        let mut period_i_cats: Vec<String> = Vec::new();
        let mut period_i_vals: Vec<f32> = Vec::new();

        let mut period_e_cats: Vec<String> = Vec::new();
        let mut period_e_vals: Vec<f32> = Vec::new();

        let mut i_cat_amounts: HashMap<String, f32> = HashMap::new();
        let mut e_cat_amounts: HashMap<String, f32> = HashMap::new();
        for tx in &period_txs[period] {
            let cat_name = tx
                .category
                .as_ref()
                .map(|c| c.name.to_owned())
                .unwrap_or("__uncategorized__".into());

            let amount = tx.amount;

            if amount > 0.0 {
                tti[period_index] += amount.abs();
                *i_cat_amounts.entry(cat_name).or_default() += amount.abs();
                total_income += amount.abs();
            } else if amount < 0.0 {
                tte[period_index] += amount.abs();
                *e_cat_amounts.entry(cat_name).or_default() += amount.abs();
                total_expenses += amount.abs();
            }
        }

        for (cat_name, amount) in i_cat_amounts {
            period_i_cats.push(cat_name);
            period_i_vals.push(amount);
        }
        for (cat_name, amount) in e_cat_amounts {
            period_e_cats.push(cat_name);
            period_e_vals.push(amount);
        }

        i_cats.push(period_i_cats);
        i.push(period_i_vals);
        e_cats.push(period_e_cats);
        e.push(period_e_vals);
    }

    return endpoints::transactions::get_stats::Output {
        dates,
        e,
        e_cats,
        i,
        i_cats,
        tti,
        tte,
        ti: total_income,
        te: total_expenses,
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
            additional: None,
            currency: "EUR".to_owned(),
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
