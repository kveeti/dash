package endpoints

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
)

func postDatedTransaction(t *testing.T, app *testApp, date string, postings []map[string]any) {
	t.Helper()
	resp := authed(t, app, http.MethodPost, "/api/v1/transactions", map[string]any{
		"date":     date + "T00:00:00Z",
		"postings": postings,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
}

func getStats(t *testing.T, app *testApp, query url.Values) statsResponse {
	t.Helper()
	if !query.Has("timezone") {
		query.Set("timezone", "UTC")
	}
	resp := authed(t, app, http.MethodGet, "/api/v1/stats?"+query.Encode(), nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out statsResponse
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out
}

func TestStatsPartialMonth(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")
	salary := createBucket(t, app, "income", "Salary")

	postDatedTransaction(t, app, "2026-06-01", []map[string]any{
		{"bucket_id": bank, "amount": -65000, "currency": "EUR"},
		{"bucket_id": groceries, "amount": 65000, "currency": "EUR"},
	})
	postDatedTransaction(t, app, "2026-06-20", []map[string]any{
		{"bucket_id": bank, "amount": -55000, "currency": "EUR"},
		{"bucket_id": groceries, "amount": 55000, "currency": "EUR"},
	})
	postDatedTransaction(t, app, "2026-06-01", []map[string]any{
		{"bucket_id": bank, "amount": 200000, "currency": "EUR"},
		{"bucket_id": salary, "amount": -200000, "currency": "EUR"},
	})
	postDatedTransaction(t, app, "2026-07-05", []map[string]any{
		{"bucket_id": bank, "amount": -80000, "currency": "EUR"},
		{"bucket_id": groceries, "amount": 80000, "currency": "EUR"},
	})
	postDatedTransaction(t, app, "2026-07-01", []map[string]any{
		{"bucket_id": bank, "amount": 200000, "currency": "EUR"},
		{"bucket_id": salary, "amount": -200000, "currency": "EUR"},
	})

	stats := getStats(t, app, url.Values{
		"period":  {"month"},
		"anchor":  {"2026-07-13"},
		"today":   {"2026-07-13"},
		"compare": {"previous"},
	})
	require.Equal(t, statsRangeResponse{From: "2026-07-01", To: "2026-07-13"}, stats.Ranges.Current)
	require.Equal(t, statsRangeResponse{From: "2026-06-01", To: "2026-06-13"}, stats.Ranges.Comparison)
	require.Equal(t, &statsRangeResponse{From: "2026-06-01", To: "2026-06-30"}, stats.Ranges.FullComparison)
	require.Equal(t, statsAmountResponse{Current: 80000, Comparison: 65000, FullComparison: ptr(int64(120000))}, stats.Summary.Expenses)
	require.Equal(t, statsAmountResponse{Current: 200000, Comparison: 200000, FullComparison: ptr(int64(200000))}, stats.Summary.Income)
	require.Equal(t, statsAmountResponse{Current: 120000, Comparison: 135000, FullComparison: ptr(int64(80000))}, stats.Summary.Net)

	categories := map[string]categoryStatResponse{}
	for _, category := range stats.Categories {
		categories[category.BucketID] = category
	}
	require.Equal(t, categoryStatResponse{BucketID: groceries, Current: 80000, Comparison: 65000}, categories[groceries])
	require.Equal(t, categoryStatResponse{BucketID: salary, Current: 200000, Comparison: 200000}, categories[salary])
}

func TestStatsCustomRanges(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	stats := getStats(t, app, url.Values{
		"period":  {"custom"},
		"from":    {"2026-06-10"},
		"to":      {"2026-07-03"},
		"today":   {"2026-07-13"},
		"compare": {"previous"},
	})
	require.Equal(t, statsRangeResponse{From: "2026-06-10", To: "2026-07-03"}, stats.Ranges.Current)
	require.Equal(t, statsRangeResponse{From: "2026-05-17", To: "2026-06-09"}, stats.Ranges.Comparison)
	require.Nil(t, stats.Ranges.FullComparison)

	resp := authed(t, app, http.MethodGet, "/api/v1/stats?period=custom&from=2025-12-20&to=2026-01-10&today=2026-07-13&compare=year&timezone=UTC", nil)
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestStatsCurrencyValuation(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	travel := createBucket(t, app, "expense", "Travel")
	unknown := createBucket(t, app, "expense", "Unknown")

	_, err := app.d.Users.Exec(`insert into rates (date, currency, rate) values
		('2026-07-12', 'EUR', 1), ('2026-07-12', 'USD', 2), ('2026-07-12', 'JPY', 200)`)
	require.NoError(t, err)
	postDatedTransaction(t, app, "2026-07-13", []map[string]any{
		{"bucket_id": bank, "amount": -10000, "currency": "USD"},
		{"bucket_id": travel, "amount": 10000, "currency": "USD"},
	})
	postDatedTransaction(t, app, "2026-07-13", []map[string]any{
		{"bucket_id": bank, "amount": -1000, "currency": "JPY"},
		{"bucket_id": travel, "amount": 1000, "currency": "JPY"},
	})
	postDatedTransaction(t, app, "2026-07-13", []map[string]any{
		{"bucket_id": bank, "amount": -1000, "currency": "GBP"},
		{"bucket_id": unknown, "amount": 1000, "currency": "GBP"},
	})

	stats := getStats(t, app, url.Values{
		"period":  {"custom"},
		"from":    {"2026-07-13"},
		"to":      {"2026-07-13"},
		"today":   {"2026-07-13"},
		"compare": {"previous"},
	})
	require.Equal(t, int64(5500), stats.Summary.Expenses.Current)
	require.Equal(t, 2, stats.Valuation["current"].FallbackTransactions)
	require.Equal(t, 1, stats.Valuation["current"].MaximumFallbackDays)
	require.Equal(t, []string{"GBP"}, stats.Valuation["current"].UnvaluedCurrencies)

	categories := map[string]categoryStatResponse{}
	for _, category := range stats.Categories {
		categories[category.BucketID] = category
	}
	require.Equal(t, int64(5500), categories[travel].Current)
	require.Equal(t, int64(0), categories[unknown].Current)
}

func TestStatsUsesUserTimezoneForTransactionDates(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	food := createBucket(t, app, "expense", "Food")
	resp := authed(t, app, http.MethodPost, "/api/v1/transactions", map[string]any{
		"date": "2026-07-01T00:00:00+03:00",
		"postings": []map[string]any{
			{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
			{"bucket_id": food, "amount": 1000, "currency": "EUR"},
		},
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	stats := getStats(t, app, url.Values{
		"period":   {"custom"},
		"from":     {"2026-07-01"},
		"to":       {"2026-07-01"},
		"today":    {"2026-07-13"},
		"compare":  {"previous"},
		"timezone": {"Europe/Helsinki"},
	})
	require.Equal(t, int64(1000), stats.Summary.Expenses.Current)
}

func TestStatsWeekLastYearUses52Weeks(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	stats := getStats(t, app, url.Values{
		"period":  {"week"},
		"anchor":  {"2020-12-30"},
		"today":   {"2020-12-30"},
		"compare": {"year"},
	})
	require.Equal(t, statsRangeResponse{From: "2020-12-28", To: "2020-12-30"}, stats.Ranges.Current)
	require.Equal(t, statsRangeResponse{From: "2019-12-30", To: "2020-01-01"}, stats.Ranges.Comparison)
	require.Equal(t, &statsRangeResponse{From: "2019-12-30", To: "2020-01-05"}, stats.Ranges.FullComparison)
}

func ptr[T any](value T) *T { return &value }
