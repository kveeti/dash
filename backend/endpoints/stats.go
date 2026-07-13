package endpoints

import (
	"money/backend/data"
	"money/backend/state"
	"net/http"
	"time"
)

const statsDateLayout = "2006-01-02"

type statsRangeResponse struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type statsRangesResponse struct {
	Current        statsRangeResponse  `json:"current"`
	Comparison     statsRangeResponse  `json:"comparison"`
	FullComparison *statsRangeResponse `json:"full_comparison,omitempty"`
}

type statsAmountResponse struct {
	Current        int64  `json:"current"`
	Comparison     int64  `json:"comparison"`
	FullComparison *int64 `json:"full_comparison,omitempty"`
}

type statsSummaryResponse struct {
	Expenses statsAmountResponse `json:"expenses"`
	Income   statsAmountResponse `json:"income"`
	Net      statsAmountResponse `json:"net"`
}

type categoryStatResponse struct {
	BucketID   string `json:"bucket_id"`
	Current    int64  `json:"current"`
	Comparison int64  `json:"comparison"`
}

type valuationResponse struct {
	FallbackTransactions int      `json:"fallback_transactions"`
	MaximumFallbackDays  int      `json:"maximum_fallback_days"`
	UnvaluedCurrencies   []string `json:"unvalued_currencies"`
}

type statsResponse struct {
	HomeCurrency string                       `json:"home_currency"`
	Ranges       statsRangesResponse          `json:"ranges"`
	Summary      statsSummaryResponse         `json:"summary"`
	Categories   []categoryStatResponse       `json:"categories"`
	Valuation    map[string]valuationResponse `json:"valuation"`
}

func parseStatsDate(value string) (time.Time, error) {
	return time.Parse(statsDateLayout, value)
}

func rangeResponse(r data.DateRange) statsRangeResponse {
	return statsRangeResponse{From: r.From.Format(statsDateLayout), To: r.To.Format(statsDateLayout)}
}

func weekRange(date time.Time) data.DateRange {
	daysFromMonday := (int(date.Weekday()) + 6) % 7
	from := date.AddDate(0, 0, -daysFromMonday)
	return data.DateRange{From: from, To: from.AddDate(0, 0, 6)}
}

func monthRange(date time.Time) data.DateRange {
	from := time.Date(date.Year(), date.Month(), 1, 0, 0, 0, 0, time.UTC)
	return data.DateRange{From: from, To: from.AddDate(0, 1, -1)}
}

func yearRange(date time.Time) data.DateRange {
	from := time.Date(date.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
	return data.DateRange{From: from, To: time.Date(date.Year(), time.December, 31, 0, 0, 0, 0, time.UTC)}
}

func clampedDate(year int, month time.Month, day int) time.Time {
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
	if day > last {
		day = last
	}
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

func shiftYear(date time.Time, years int) time.Time {
	return clampedDate(date.Year()+years, date.Month(), date.Day())
}

func calendarStatsRanges(period, compare string, anchor, today time.Time) (data.DateRange, data.DateRange, *data.DateRange, error) {
	var selected, currentPeriod data.DateRange
	switch period {
	case "week":
		selected, currentPeriod = weekRange(anchor), weekRange(today)
	case "month":
		selected, currentPeriod = monthRange(anchor), monthRange(today)
	case "year":
		selected, currentPeriod = yearRange(anchor), yearRange(today)
	default:
		return data.DateRange{}, data.DateRange{}, nil, NewErr("invalid stats period", http.StatusBadRequest)
	}
	if selected.From.After(currentPeriod.From) {
		return data.DateRange{}, data.DateRange{}, nil, NewErr("stats period cannot be in the future", http.StatusBadRequest)
	}

	current := selected
	if selected.From.Equal(currentPeriod.From) {
		current.To = today
	}

	var target data.DateRange
	switch compare {
	case "previous":
		switch period {
		case "week":
			target = weekRange(selected.From.AddDate(0, 0, -7))
		case "month":
			target = monthRange(selected.From.AddDate(0, -1, 0))
		case "year":
			target = yearRange(selected.From.AddDate(-1, 0, 0))
		}
	case "year":
		switch period {
		case "week":
			target = data.DateRange{From: selected.From.AddDate(0, 0, -364), To: selected.To.AddDate(0, 0, -364)}
		case "month":
			target = monthRange(selected.From.AddDate(-1, 0, 0))
		case "year":
			target = yearRange(selected.From.AddDate(-1, 0, 0))
		}
	default:
		return data.DateRange{}, data.DateRange{}, nil, NewErr("invalid stats comparison", http.StatusBadRequest)
	}

	comparison := target
	if current.To.Before(selected.To) {
		switch period {
		case "week":
			comparison.To = target.From.AddDate(0, 0, int(current.To.Sub(selected.From).Hours()/24))
		case "month":
			comparison.To = clampedDate(target.From.Year(), target.From.Month(), current.To.Day())
		case "year":
			comparison.To = clampedDate(target.From.Year(), current.To.Month(), current.To.Day())
		}
		if comparison == target {
			return current, comparison, nil, nil
		}
		return current, comparison, &target, nil
	}
	return current, comparison, nil, nil
}

func customStatsRanges(compare string, from, to, today time.Time) (data.DateRange, data.DateRange, error) {
	if from.After(to) || to.After(today) {
		return data.DateRange{}, data.DateRange{}, NewErr("invalid custom stats range", http.StatusBadRequest)
	}
	current := data.DateRange{From: from, To: to}
	switch compare {
	case "previous":
		days := int(to.Sub(from).Hours()/24) + 1
		comparisonTo := from.AddDate(0, 0, -1)
		return current, data.DateRange{From: comparisonTo.AddDate(0, 0, -(days - 1)), To: comparisonTo}, nil
	case "year":
		if from.Year() != to.Year() {
			return data.DateRange{}, data.DateRange{}, NewErr("last-year comparison requires a custom range within one year", http.StatusBadRequest)
		}
		return current, data.DateRange{From: shiftYear(from, -1), To: shiftYear(to, -1)}, nil
	default:
		return data.DateRange{}, data.DateRange{}, NewErr("invalid stats comparison", http.StatusBadRequest)
	}
}

func HandleGetStats(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		query := r.URL.Query()
		today, err := parseStatsDate(query.Get("today"))
		if err != nil {
			return NewErr("invalid stats today date", http.StatusBadRequest)
		}
		timezone := query.Get("timezone")
		if _, err := time.LoadLocation(timezone); err != nil {
			return NewErr("invalid stats timezone", http.StatusBadRequest)
		}

		period := query.Get("period")
		compare := query.Get("compare")
		var current, comparison data.DateRange
		var full *data.DateRange
		if period == "custom" {
			from, fromErr := parseStatsDate(query.Get("from"))
			to, toErr := parseStatsDate(query.Get("to"))
			if fromErr != nil || toErr != nil {
				return NewErr("invalid custom stats dates", http.StatusBadRequest)
			}
			current, comparison, err = customStatsRanges(compare, from, to, today)
		} else {
			anchor, anchorErr := parseStatsDate(query.Get("anchor"))
			if anchorErr != nil {
				return NewErr("invalid stats anchor date", http.StatusBadRequest)
			}
			current, comparison, full, err = calendarStatsRanges(period, compare, anchor, today)
		}
		if err != nil {
			return err
		}

		stats, err := state.Data.GetStats(r.Context(), userID, current, comparison, full, timezone)
		if err != nil {
			return NewUnexpectedErr("error getting stats: %w", err)
		}
		out := statsResponse{
			HomeCurrency: stats.HomeCurrency,
			Ranges:       statsRangesResponse{Current: rangeResponse(current), Comparison: rangeResponse(comparison)},
			Summary: statsSummaryResponse{
				Expenses: statsAmountResponse{Current: stats.Expenses.Current, Comparison: stats.Expenses.Comparison, FullComparison: stats.Expenses.FullComparison},
				Income:   statsAmountResponse{Current: stats.Income.Current, Comparison: stats.Income.Comparison, FullComparison: stats.Income.FullComparison},
				Net:      statsAmountResponse{Current: stats.Net.Current, Comparison: stats.Net.Comparison, FullComparison: stats.Net.FullComparison},
			},
			Categories: make([]categoryStatResponse, len(stats.Categories)),
			Valuation:  map[string]valuationResponse{},
		}
		if full != nil {
			value := rangeResponse(*full)
			out.Ranges.FullComparison = &value
		}
		for i, category := range stats.Categories {
			out.Categories[i] = categoryStatResponse{BucketID: category.BucketID, Current: category.Current, Comparison: category.Comparison}
		}
		for label, value := range stats.Valuation {
			if label == "full_comparison" && full == nil {
				continue
			}
			if value.UnvaluedCurrencies == nil {
				value.UnvaluedCurrencies = []string{}
			}
			out.Valuation[label] = valuationResponse{FallbackTransactions: value.FallbackTransactions, MaximumFallbackDays: value.MaximumFallbackDays, UnvaluedCurrencies: value.UnvaluedCurrencies}
		}
		Json(w, out)
		return nil
	}
}
