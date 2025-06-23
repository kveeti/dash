use std::collections::HashMap;

use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use utoipa::{IntoParams, ToSchema};

use crate::{auth_middleware::LoggedInUser, data::Tx, error::ApiError, state::AppState};

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct Input {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

#[derive(Debug, ToSchema, Serialize)]
pub struct Output {
    pub dates: Vec<String>,
    pub i_cats: Vec<Vec<String>>,
    pub i: Vec<Vec<f32>>,
    pub e_cats: Vec<Vec<String>>,
    pub e: Vec<Vec<f32>>,
    pub n_cats: Vec<Vec<String>>,
    pub n: Vec<Vec<f32>>,
    pub tti: Vec<f32>,
    pub tte: Vec<f32>,
    pub ttn: Vec<f32>,
    pub ti: f32,
    pub te: f32,
}

#[derive(Serialize, ToSchema)]
pub enum OutputDataValue {
    Period(String),
    Value(f32),
}

#[utoipa::path(
    get,
    path = "/v1/transactions/stats",
    operation_id = "v1/transactions/stats",
    params(
        Input
    ),
    responses(
        (status = 200, body = Output)
    )
)]
#[instrument(skip(state))]
pub async fn stats(
    State(state): State<AppState>,
    user: LoggedInUser,
    input: Query<Input>,
) -> Result<impl IntoResponse, ApiError> {
    let result = compute(
        state
            .data
            .tx_stats(&user.id, &input.start, &input.end)
            .await?,
    );

    return Ok(Json(result));
}

fn compute(mut tx_map: HashMap<String, Tx>) -> Output {
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
    let mut n_cats: Vec<Vec<String>> = Vec::new();
    let mut n: Vec<Vec<f32>> = Vec::new();

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
    let mut ttn: Vec<f32> = vec![0.0; periods.len()];

    for (period_index, period) in periods.iter().enumerate() {
        dates.push(period.clone());

        let mut period_i_cats: Vec<String> = Vec::new();
        let mut period_i_vals: Vec<f32> = Vec::new();

        let mut period_e_cats: Vec<String> = Vec::new();
        let mut period_e_vals: Vec<f32> = Vec::new();

        let mut period_n_cats: Vec<String> = Vec::new();
        let mut period_n_vals: Vec<f32> = Vec::new();

        let mut i_cat_amounts: HashMap<String, f32> = HashMap::new();
        let mut e_cat_amounts: HashMap<String, f32> = HashMap::new();
        let mut n_cat_amounts: HashMap<String, f32> = HashMap::new();

        for tx in &period_txs[period] {
            let (cat_name, cat_is_neutral) = tx
                .category
                .as_ref()
                .map(|c| (c.name.to_owned(), c.is_neutral.to_owned()))
                .unwrap_or(("__uncategorized__".into(), false));

            let amount = tx.amount;

            if cat_is_neutral {
                ttn[period_index] += amount.abs();
                *n_cat_amounts.entry(cat_name).or_default() += amount.abs();
                //total_income += amount.abs();
            } else if amount > 0.0 {
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
        for (cat_name, amount) in n_cat_amounts {
            period_n_cats.push(cat_name);
            period_n_vals.push(amount);
        }

        i_cats.push(period_i_cats);
        i.push(period_i_vals);
        e_cats.push(period_e_cats);
        e.push(period_e_vals);
        n_cats.push(period_n_cats);
        n.push(period_n_vals);
    }

    return Output {
        dates,
        e,
        e_cats,
        i,
        i_cats,
        n,
        n_cats,
        tti,
        tte,
        ttn,
        ti: total_income,
        te: total_expenses,
    };
}
