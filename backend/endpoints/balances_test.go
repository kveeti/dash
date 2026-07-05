package endpoints

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func getBalances(t *testing.T, app *testApp) map[string]map[string]int64 {
	t.Helper()
	resp := authed(t, app, http.MethodGet, "/api/v1/balances", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var rows []struct {
		BucketID string `json:"bucket_id"`
		Currency string `json:"currency"`
		Amount   int64  `json:"amount"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&rows))

	out := map[string]map[string]int64{}
	for _, r := range rows {
		if out[r.BucketID] == nil {
			out[r.BucketID] = map[string]int64{}
		}
		out[r.BucketID][r.Currency] = r.Amount
	}
	return out
}

func TestBalancesSumPostings(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")

	postTransaction(t, app, []map[string]any{
		{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
		{"bucket_id": groceries, "amount": 1000, "currency": "EUR"},
	})
	postTransaction(t, app, []map[string]any{
		{"bucket_id": bank, "amount": -500, "currency": "EUR"},
		{"bucket_id": groceries, "amount": 500, "currency": "EUR"},
	})

	balances := getBalances(t, app)
	require.Equal(t, int64(-1500), balances[bank]["EUR"])
	require.Equal(t, int64(1500), balances[groceries]["EUR"])
}

// A bucket holding two currencies reports them side by side, never blended.
func TestBalancesPerCurrency(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	clearing := clearingBucketID(t, app)

	postTransaction(t, app, []map[string]any{
		{"bucket_id": bank, "amount": -100, "currency": "USD"},
		{"bucket_id": clearing, "amount": 100, "currency": "USD"},
		{"bucket_id": clearing, "amount": -91, "currency": "EUR"},
		{"bucket_id": bank, "amount": 91, "currency": "EUR"},
	})

	balances := getBalances(t, app)
	require.Equal(t, int64(-100), balances[bank]["USD"])
	require.Equal(t, int64(91), balances[bank]["EUR"])
	require.Equal(t, int64(100), balances[clearing]["USD"])
	require.Equal(t, int64(-91), balances[clearing]["EUR"])
}

func TestBalancesRequireAuth(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	resp, err := app.client.Get(app.url + "/api/v1/balances")
	require.NoError(t, err)
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}
