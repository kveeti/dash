use std::collections::HashMap;

use axum::{
    Json,
    extract::{Query, State},
    response::IntoResponse,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};

use crate::{auth_middleware::LoggedInUser, data::TxCategory, error::ApiError, state::AppState};

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "docs", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "docs", into_params(parameter_in = Query))]
pub struct Input {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    #[cfg_attr(feature = "docs", param(value_type = String))]
    pub tz: Tz,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
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

#[derive(Serialize)]
#[cfg_attr(feature = "docs", derive(utoipa::ToSchema))]
pub enum OutputDataValue {
    Period(String),
    Value(f32),
}

#[cfg_attr(feature = "docs", utoipa::path(
    get,
    path = "/v1/transactions/stats",
    operation_id = "v1/transactions/stats",
    params(
        Input
    ),
    responses(
        (status = 200, body = Output)
    )
))]
#[tracing::instrument(skip(state))]
pub async fn get_stats(
    State(state): State<AppState>,
    user: LoggedInUser,
    input: Query<Input>,
) -> Result<impl IntoResponse, ApiError> {
    let result = compute(
        state
            .data
            .tx_stats(&user.id, &input.start, &input.end)
            .await?,
        &input.start.with_timezone(&input.tz).naive_local().date(),
        &input.end.with_timezone(&input.tz).naive_local().date(),
    );

    return Ok(Json(result));
}

fn compute(
    mut tx_map: HashMap<String, StatsTx>,
    start_date: &NaiveDate,
    end_date: &NaiveDate,
) -> Output {
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

    let mut periods: Vec<String> = Vec::new();
    let mut year = start_date.year();
    let mut month = start_date.month();

    let end_year = end_date.year();
    let end_month = end_date.month();

    loop {
        periods.push(format!("{year}-{month:02}"));

        if year == end_year && month == end_month {
            break;
        }

        month += 1;
        if month > 12 {
            month = 1;
            year += 1;
        }
    }

    let mut period_txs: HashMap<String, Vec<&StatsTx>> = HashMap::new();
    for tx in tx_map.values() {
        if tx.amount == 0.0 {
            continue;
        }
        let month = tx.date.month();
        let year = tx.date.year();
        let period = format!("{year}-{month:02}");
        period_txs.entry(period).or_default().push(tx);
    }

    let period_count = periods.len();
    let mut i_cats: Vec<Vec<String>> = vec![vec![]; period_count];
    let mut i: Vec<Vec<f32>> = vec![vec![]; period_count];
    let mut e_cats: Vec<Vec<String>> = vec![vec![]; period_count];
    let mut e: Vec<Vec<f32>> = vec![vec![]; period_count];
    let mut n_cats: Vec<Vec<String>> = vec![vec![]; period_count];
    let mut n: Vec<Vec<f32>> = vec![vec![]; period_count];
    let mut tti: Vec<f32> = vec![0.0; period_count];
    let mut tte: Vec<f32> = vec![0.0; period_count];
    let mut ttn: Vec<f32> = vec![0.0; period_count];

    let mut total_income: f32 = 0.0;
    let mut total_expenses: f32 = 0.0;

    for (index, period) in periods.iter().enumerate() {
        match period_txs.get(period) {
            None => continue,
            Some(txs) => {
                let mut i_cat_amounts: HashMap<String, f32> = HashMap::new();
                let mut e_cat_amounts: HashMap<String, f32> = HashMap::new();
                let mut n_cat_amounts: HashMap<String, f32> = HashMap::new();

                let mut period_tti = 0.0;
                let mut period_tte = 0.0;
                let mut period_ttn = 0.0;

                for tx in txs {
                    let (cat_name, cat_is_neutral) = tx
                        .category
                        .as_ref()
                        .map(|c| (c.name.to_owned(), c.is_neutral))
                        .unwrap_or(("__uncategorized__".into(), false));

                    let amount = tx.amount;
                    let abs_amount = amount.abs();

                    if cat_is_neutral {
                        period_ttn += abs_amount;
                        *n_cat_amounts.entry(cat_name).or_default() += abs_amount;
                    } else if amount > 0.0 {
                        period_tti += abs_amount;
                        *i_cat_amounts.entry(cat_name).or_default() += abs_amount;
                        total_income += abs_amount;
                    } else if amount < 0.0 {
                        period_tte += abs_amount;
                        *e_cat_amounts.entry(cat_name).or_default() += abs_amount;
                        total_expenses += abs_amount;
                    }
                }

                let mut i_pairs: Vec<_> = i_cat_amounts.into_iter().collect();
                i_pairs.sort_unstable_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
                let (period_i_cats, period_i_vals): (Vec<_>, Vec<_>) = i_pairs.into_iter().unzip();

                let mut e_pairs: Vec<_> = e_cat_amounts.into_iter().collect();
                e_pairs.sort_unstable_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
                let (period_e_cats, period_e_vals): (Vec<_>, Vec<_>) = e_pairs.into_iter().unzip();

                let mut n_pairs: Vec<_> = n_cat_amounts.into_iter().collect();
                n_pairs.sort_unstable_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
                let (period_n_cats, period_n_vals): (Vec<_>, Vec<_>) = n_pairs.into_iter().unzip();

                i_cats[index] = period_i_cats;
                i[index] = period_i_vals;
                e_cats[index] = period_e_cats;
                e[index] = period_e_vals;
                n_cats[index] = period_n_cats;
                n[index] = period_n_vals;

                tti[index] = period_tti;
                tte[index] = period_tte;
                ttn[index] = period_ttn;
            }
        }
    }

    return Output {
        dates: periods,
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

pub struct StatsTx {
    pub id: String,
    pub date: DateTime<Utc>,
    pub amount: f32,
    pub counter_party: String,
    pub additional: Option<String>,
    pub currency: String,
    pub category: Option<TxCategory>,
    pub links: Vec<String>,
}
