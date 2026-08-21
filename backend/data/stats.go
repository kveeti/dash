package data

import (
	"context"
	"database/sql"
	"fmt"
	"math/big"
	"sort"
	"time"
)

type DateRange struct {
	From time.Time
	To   time.Time
}

type StatAmount struct {
	Current        int64
	Comparison     int64
	FullComparison *int64
}

type CategoryStat struct {
	BucketID   string
	Current    int64
	Comparison int64
}

type Valuation struct {
	FallbackTransactions int
	MaximumFallbackDays  int
	UnvaluedCurrencies   []string
}

type Stats struct {
	HomeCurrency string
	Expenses     StatAmount
	Income       StatAmount
	Net          StatAmount
	Categories   []CategoryStat
	Valuation    map[string]Valuation
}

type statKey struct {
	label    string
	bucketID string
	kind     string
}

func pow10(n int) *big.Int {
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n)), nil)
}

func convertAmount(amount int64, kind string, sourceRate, homeRate *big.Rat, sourceScale, homeScale int) *big.Rat {
	value := new(big.Rat).SetInt64(amount)
	if kind == string(KindIncome) {
		value.Neg(value)
	}
	if sourceRate != nil {
		value.Mul(value, homeRate)
		value.Quo(value, sourceRate)
	}
	value.Mul(value, new(big.Rat).SetInt(pow10(homeScale)))
	value.Quo(value, new(big.Rat).SetInt(pow10(sourceScale)))
	return value
}

func roundRat(value *big.Rat) (int64, error) {
	q, remainder := new(big.Int), new(big.Int)
	q.QuoRem(value.Num(), value.Denom(), remainder)
	twice := new(big.Int).Lsh(new(big.Int).Abs(remainder), 1)
	if twice.Cmp(value.Denom()) >= 0 {
		if value.Sign() < 0 {
			q.Sub(q, big.NewInt(1))
		} else {
			q.Add(q, big.NewInt(1))
		}
	}
	if !q.IsInt64() {
		return 0, fmt.Errorf("stats amount overflows bigint")
	}
	return q.Int64(), nil
}

func (d *Data) GetStats(ctx context.Context, userID string, current, comparison DateRange, full *DateRange) (*Stats, error) {
	valuation := map[string]Valuation{
		"current":         {},
		"comparison":      {},
		"full_comparison": {},
	}
	amounts := map[statKey]*big.Rat{}
	missing := map[string]map[string]bool{}
	for _, label := range []string{"current", "comparison", "full_comparison"} {
		missing[label] = map[string]bool{}
	}
	args := []any{userID, current.From, current.To, comparison.From, comparison.To, nil, nil}
	if full != nil {
		args[5] = full.From
		args[6] = full.To
	}

	rows, err := d.db.QueryContext(ctx, `
		with user_config as (
			select upper(home_currency) as home_currency
			from users
			where id = $1
		), requested_ranges(label, from_date, to_date) as (
			values ('current', $2::date, $3::date),
			       ('comparison', $4::date, $5::date),
			       ('full_comparison', $6::date, $7::date)
		), ranges as (
			select *
			from requested_ranges
			where from_date is not null
		), category_postings as materialized (
			select
				range.label,
				transaction.id as transaction_id,
				posting.bucket_id,
				bucket.kind,
				coalesce(posting.stats_date, transaction.occurred_on) as date,
				upper(posting.currency) as currency,
				posting.amount
			from postings posting
			join transactions transaction on transaction.id = posting.transaction_id
			join buckets bucket on bucket.id = posting.bucket_id
			join ranges range
			  on coalesce(posting.stats_date, transaction.occurred_on)
			     between range.from_date and range.to_date
			where bucket.owner_user_id = $1
			  and not bucket.hidden
			  and bucket.kind in ('expense', 'income')
		), native_amounts as (
			select
				label,
				bucket_id,
				kind,
				date,
				currency,
				sum(amount) as amount
			from category_postings
			group by label, bucket_id, kind, date, currency
		), fallback_postings as (
			select distinct label, transaction_id, date, currency
			from category_postings
			where currency <> (select home_currency from user_config)
		), fallbacks as (
			select
				posting.label,
				count(distinct posting.transaction_id) as transaction_count,
				max(posting.date - rate.date) as maximum_days
			from fallback_postings posting
			join lateral (
				select source.date
				from rates source
				join rates home
				  on home.date = source.date
				 and home.currency = (select home_currency from user_config)
				where source.currency = posting.currency
				  and source.date <= posting.date
				order by source.date desc
				limit 1
			) rate on rate.date < posting.date
			group by posting.label
		), valued_amounts as (
			select
				amount.label,
				amount.bucket_id,
				amount.kind,
				amount.date,
				amount.currency,
				amount.amount,
				source_currency.exponent as source_exponent,
				home_currency.exponent as home_exponent,
				rate.date as rate_date,
				rate.source_rate,
				rate.home_rate
			from native_amounts amount
			join currencies source_currency on source_currency.code = amount.currency
			join currencies home_currency
			  on home_currency.code = (select home_currency from user_config)
			left join lateral (
				select
					source.date,
					source.rate as source_rate,
					home.rate as home_rate
				from rates source
				join rates home
				  on home.date = source.date
				 and home.currency = (select home_currency from user_config)
				where source.currency = amount.currency
				  and source.date <= amount.date
				order by source.date desc
				limit 1
			) rate on amount.currency <> (select home_currency from user_config)
		)
		select
			user_config.home_currency,
			amount.label,
			amount.bucket_id,
			amount.kind,
			amount.date,
			amount.currency,
			amount.amount,
			amount.source_exponent,
			amount.home_exponent,
			amount.rate_date,
			amount.source_rate::text,
			amount.home_rate::text,
			fallback.transaction_count,
			fallback.maximum_days
		from user_config
		left join valued_amounts amount on true
		left join fallbacks fallback on fallback.label = amount.label
		order by amount.label, amount.bucket_id, amount.date, amount.currency
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var home string
	foundUser := false

	for rows.Next() {
		foundUser = true
		var label, bucketID, kind, source sql.NullString
		var date, rateDate sql.NullTime
		var amount, sourceScale, homeScale sql.NullInt64
		var sourceText, homeText sql.NullString
		var fallbackCount, fallbackDays sql.NullInt64
		if err := rows.Scan(
			&home,
			&label,
			&bucketID,
			&kind,
			&date,
			&source,
			&amount,
			&sourceScale,
			&homeScale,
			&rateDate,
			&sourceText,
			&homeText,
			&fallbackCount,
			&fallbackDays,
		); err != nil {
			return nil, err
		}
		if !label.Valid {
			continue
		}
		if fallbackCount.Valid {
			value := valuation[label.String]
			value.FallbackTransactions = int(fallbackCount.Int64)
			value.MaximumFallbackDays = int(fallbackDays.Int64)
			valuation[label.String] = value
		}

		key := statKey{label: label.String, bucketID: bucketID.String, kind: kind.String}
		if amounts[key] == nil {
			amounts[key] = new(big.Rat)
		}
		var sourceRate, homeRate *big.Rat
		if source.String != home {
			if !rateDate.Valid || !sourceText.Valid || !homeText.Valid {
				missing[label.String][source.String] = true
				continue
			}
			sourceRate, _ = new(big.Rat).SetString(sourceText.String)
			homeRate, _ = new(big.Rat).SetString(homeText.String)
			if sourceRate == nil || homeRate == nil {
				return nil, fmt.Errorf("invalid stored rate")
			}
		}
		amounts[key].Add(amounts[key], convertAmount(
			amount.Int64,
			kind.String,
			sourceRate,
			homeRate,
			int(sourceScale.Int64),
			int(homeScale.Int64),
		))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !foundUser {
		return nil, ErrNotFound
	}

	for label, currencies := range missing {
		v := valuation[label]
		for code := range currencies {
			v.UnvaluedCurrencies = append(v.UnvaluedCurrencies, code)
		}
		sort.Strings(v.UnvaluedCurrencies)
		valuation[label] = v
	}

	rounded := map[statKey]int64{}
	for key, value := range amounts {
		rounded[key], err = roundRat(value)
		if err != nil {
			return nil, err
		}
	}

	bucketIDs := map[string]bool{}
	for key := range rounded {
		if key.label != "full_comparison" {
			bucketIDs[key.bucketID] = true
		}
	}
	ids := make([]string, 0, len(bucketIDs))
	for id := range bucketIDs {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	stats := &Stats{HomeCurrency: home, Valuation: valuation}
	for _, id := range ids {
		var currentAmount, comparisonAmount int64
		for key, amount := range rounded {
			if key.bucketID != id {
				continue
			}
			switch key.label {
			case "current":
				currentAmount += amount
			case "comparison":
				comparisonAmount += amount
			}
		}
		stats.Categories = append(stats.Categories, CategoryStat{BucketID: id, Current: currentAmount, Comparison: comparisonAmount})
	}

	sums := map[string]map[string]int64{}
	for key, amount := range rounded {
		if sums[key.label] == nil {
			sums[key.label] = map[string]int64{}
		}
		sums[key.label][key.kind] += amount
	}
	stats.Expenses.Current = sums["current"][string(KindExpense)]
	stats.Expenses.Comparison = sums["comparison"][string(KindExpense)]
	stats.Income.Current = sums["current"][string(KindIncome)]
	stats.Income.Comparison = sums["comparison"][string(KindIncome)]
	stats.Net.Current = stats.Income.Current - stats.Expenses.Current
	stats.Net.Comparison = stats.Income.Comparison - stats.Expenses.Comparison
	if full != nil {
		expenses := sums["full_comparison"][string(KindExpense)]
		income := sums["full_comparison"][string(KindIncome)]
		net := income - expenses
		stats.Expenses.FullComparison = &expenses
		stats.Income.FullComparison = &income
		stats.Net.FullComparison = &net
	}
	return stats, nil
}
