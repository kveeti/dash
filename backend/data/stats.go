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

func rangeArgs(userID string, current, comparison DateRange, full *DateRange) []any {
	args := []any{userID, current.From, current.To, comparison.From, comparison.To, nil, nil}
	if full != nil {
		args[5] = full.From
		args[6] = full.To
	}
	return args
}

func rateArgs(userID string, current, comparison DateRange, full *DateRange, home string) []any {
	return append(rangeArgs(userID, current, comparison, full), home)
}

func fallbackArgs(userID string, current, comparison DateRange, full *DateRange) []any {
	return rangeArgs(userID, current, comparison, full)
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

func (d *Data) GetStats(ctx context.Context, userID string, current, comparison DateRange, full *DateRange, timezone string) (*Stats, error) {
	valuation := map[string]Valuation{
		"current":         {},
		"comparison":      {},
		"full_comparison": {},
	}
	fallbackRows, err := d.db.QueryContext(ctx, `
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
		), category_postings as (
			select
				r.label,
				t.id as transaction_id,
				coalesce(p.stats_date, t.occurred_on) as date,
				upper(p.currency) as currency
			from postings p
			join transactions t on t.id = p.transaction_id
			join buckets b on b.id = p.bucket_id
			join ranges r
			  on coalesce(p.stats_date, t.occurred_on)
			     between r.from_date and r.to_date
			where p.bucket_id in (
				select id
				from buckets
				where owner_user_id = $1
				  and not hidden
			)
			  and b.kind in ('expense', 'income')
			  and upper(p.currency) <> (select home_currency from user_config)
		), fallbacks as (
			select
				posting.label,
				count(distinct posting.transaction_id) as transaction_count,
				max(posting.date - rate.date) as maximum_days
			from category_postings posting
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
		)
		select
			user_config.home_currency,
			fallbacks.label,
			fallbacks.transaction_count,
			fallbacks.maximum_days
		from user_config
		left join fallbacks on true
		order by fallbacks.label
	`, fallbackArgs(userID, current, comparison, full)...)
	if err != nil {
		return nil, err
	}
	var home string
	foundUser := false
	for fallbackRows.Next() {
		foundUser = true
		var label sql.NullString
		var count, days sql.NullInt64
		if err := fallbackRows.Scan(&home, &label, &count, &days); err != nil {
			fallbackRows.Close()
			return nil, err
		}
		if label.Valid {
			v := valuation[label.String]
			v.FallbackTransactions = int(count.Int64)
			v.MaximumFallbackDays = int(days.Int64)
			valuation[label.String] = v
		}
	}
	if err := fallbackRows.Close(); err != nil {
		return nil, err
	}
	if err := fallbackRows.Err(); err != nil {
		return nil, err
	}
	if !foundUser {
		return nil, ErrNotFound
	}
	amounts := map[statKey]*big.Rat{}
	missing := map[string]map[string]bool{}
	for _, label := range []string{"current", "comparison", "full_comparison"} {
		missing[label] = map[string]bool{}
	}

	rows, err := d.db.QueryContext(ctx, `
		with requested_ranges(label, from_date, to_date) as (
			values ('current', $2::date, $3::date),
			       ('comparison', $4::date, $5::date),
			       ('full_comparison', $6::date, $7::date)
		), ranges as (
			select *
			from requested_ranges
			where from_date is not null
		), native_amounts as (
			select
				r.label,
				p.bucket_id,
				b.kind,
				coalesce(p.stats_date, t.occurred_on) as date,
				upper(p.currency) as currency,
				sum(p.amount) as amount
			from postings p
			join transactions t on t.id = p.transaction_id
			join buckets b on b.id = p.bucket_id
			join ranges r
			  on coalesce(p.stats_date, t.occurred_on)
			     between r.from_date and r.to_date
			where p.bucket_id in (
				select id
				from buckets
				where owner_user_id = $1
				  and not hidden
			)
			  and b.kind in ('expense', 'income')
			group by
				r.label,
				p.bucket_id,
				b.kind,
				coalesce(p.stats_date, t.occurred_on),
				upper(p.currency)
		)
		select
			amount.label,
			amount.bucket_id,
			amount.kind,
			amount.date,
			amount.currency,
			amount.amount,
			source_currency.exponent,
			home_currency.exponent,
			rate.date,
			rate.source_rate::text,
			rate.home_rate::text
		from native_amounts amount
		join currencies source_currency on source_currency.code = amount.currency
		join currencies home_currency on home_currency.code = $8
		left join lateral (
			select
				source.date,
				source.rate as source_rate,
				home.rate as home_rate
			from rates source
			join rates home
			  on home.date = source.date
			 and home.currency = $8
			where source.currency = amount.currency
			  and source.date <= amount.date
			order by source.date desc
			limit 1
		) rate on amount.currency <> $8
		order by amount.label, amount.bucket_id, amount.date, amount.currency
	`, rateArgs(userID, current, comparison, full, home)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var label, bucketID, kind, source string
		var date time.Time
		var amount int64
		var sourceScale, homeScale int
		var rateDate sql.NullTime
		var sourceText, homeText sql.NullString
		if err := rows.Scan(&label, &bucketID, &kind, &date, &source, &amount, &sourceScale, &homeScale, &rateDate, &sourceText, &homeText); err != nil {
			return nil, err
		}

		key := statKey{label: label, bucketID: bucketID, kind: kind}
		if amounts[key] == nil {
			amounts[key] = new(big.Rat)
		}
		var sourceRate, homeRate *big.Rat
		if source != home {
			if !rateDate.Valid || !sourceText.Valid || !homeText.Valid {
				missing[label][source] = true
				continue
			}
			sourceRate, _ = new(big.Rat).SetString(sourceText.String)
			homeRate, _ = new(big.Rat).SetString(homeText.String)
			if sourceRate == nil || homeRate == nil {
				return nil, fmt.Errorf("invalid stored rate")
			}
		}
		amounts[key].Add(amounts[key], convertAmount(amount, kind, sourceRate, homeRate, sourceScale, homeScale))
	}
	if err := rows.Err(); err != nil {
		return nil, err
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
