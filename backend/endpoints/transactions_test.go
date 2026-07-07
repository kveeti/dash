package endpoints

import (
	"encoding/json"
	"money/backend/data"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func decodeTxns(t *testing.T, resp *http.Response) []map[string]any {
	t.Helper()
	var body struct {
		Transactions []map[string]any `json:"transactions"`
		NextCursor   *struct {
			Date string `json:"date"`
			ID   string `json:"id"`
		} `json:"next_cursor"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	return body.Transactions
}

func createBucket(t *testing.T, app *testApp, kind, name string) string {
	t.Helper()
	resp := authed(t, app, http.MethodPost, "/api/v1/buckets", map[string]any{"kind": kind, "name": name})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var b map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&b))
	return b["id"].(string)
}

func clearingBucketID(t *testing.T, app *testApp) string {
	t.Helper()
	resp := authed(t, app, http.MethodGet, "/api/v1/buckets", nil)
	for _, b := range decodeBuckets(t, resp) {
		if b["kind"] == "clearing" {
			return b["id"].(string)
		}
	}
	t.Fatal("no clearing bucket")
	return ""
}

func postTransaction(t *testing.T, app *testApp, postings []map[string]any) *http.Response {
	t.Helper()
	return authed(t, app, http.MethodPost, "/api/v1/transactions", map[string]any{
		"date":        "2026-07-01T00:00:00Z",
		"description": "test",
		"postings":    postings,
	})
}

func createTransaction(t *testing.T, app *testApp, postings []map[string]any) string {
	t.Helper()
	resp := postTransaction(t, app, postings)
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var txn map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&txn))
	return txn["id"].(string)
}

func TestCreateBalancedTransaction(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")

	resp := postTransaction(t, app, []map[string]any{
		{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
		{"bucket_id": groceries, "amount": 1000, "currency": "EUR"},
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	resp = authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	txns := decodeTxns(t, resp)
	require.Len(t, txns, 1)
	require.Equal(t, "2026-07-01T00:00:00Z", txns[0]["date"])
	require.Len(t, txns[0]["postings"], 2)
}

func TestCounterpartyRoundTrips(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")

	resp := authed(t, app, http.MethodPost, "/api/v1/transactions", map[string]any{
		"date":         "2026-07-01T00:00:00Z",
		"counterparty": "K-Market",
		"description":  "weekly shop",
		"postings": []map[string]any{
			{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
			{"bucket_id": groceries, "amount": 1000, "currency": "EUR"},
		},
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var created map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
	require.Equal(t, "K-Market", created["counterparty"])

	resp = authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	txns := decodeTxns(t, resp)
	require.Len(t, txns, 1)
	require.Equal(t, "K-Market", txns[0]["counterparty"])

	resp = authed(t, app, http.MethodPatch, "/api/v1/transactions/"+created["id"].(string), map[string]any{
		"date":         "2026-07-01T00:00:00Z",
		"counterparty": "Lidl",
		"description":  "weekly shop",
		"postings": []map[string]any{
			{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
			{"bucket_id": groceries, "amount": 1000, "currency": "EUR"},
		},
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)

	resp = authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	txns = decodeTxns(t, resp)
	require.Equal(t, "Lidl", txns[0]["counterparty"])
}

func TestCounterpartyDefaultsEmpty(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")

	resp := postTransaction(t, app, []map[string]any{
		{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
		{"bucket_id": groceries, "amount": 1000, "currency": "EUR"},
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var created map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
	require.Equal(t, "", created["counterparty"])
}

func TestListOrdersByDateDesc(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")

	post := func(date string) {
		resp := authed(t, app, http.MethodPost, "/api/v1/transactions", map[string]any{
			"date":        date,
			"description": date,
			"postings": []map[string]any{
				{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
				{"bucket_id": groceries, "amount": 1000, "currency": "EUR"},
			},
		})
		require.Equal(t, http.StatusCreated, resp.StatusCode)
	}
	post("2026-07-01T00:00:00Z")
	post("2026-07-03T00:00:00Z")
	post("2026-07-02T00:00:00Z")

	resp := authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	txns := decodeTxns(t, resp)
	require.Len(t, txns, 3)
	require.Equal(t, "2026-07-03T00:00:00Z", txns[0]["date"])
	require.Equal(t, "2026-07-02T00:00:00Z", txns[1]["date"])
	require.Equal(t, "2026-07-01T00:00:00Z", txns[2]["date"])
}

func TestSearchByCounterparty(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")

	post := func(counterparty string) {
		resp := authed(t, app, http.MethodPost, "/api/v1/transactions", map[string]any{
			"date":         "2026-07-01T00:00:00Z",
			"counterparty": counterparty,
			"postings": []map[string]any{
				{"bucket_id": bank, "amount": -100, "currency": "EUR"},
				{"bucket_id": groceries, "amount": 100, "currency": "EUR"},
			},
		})
		require.Equal(t, http.StatusCreated, resp.StatusCode)
	}
	post("K-Market Kamppi")
	post("K-Market Helsinki")
	post("Shell")

	resp := authed(t, app, http.MethodGet, "/api/v1/transactions?q=market", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Len(t, decodeTxns(t, resp), 2)
}

// BulkCategorize recategorizes existing transactions (transactions page), repointing
// each one's single expense/income leg to a new category.
func TestBulkCategorize(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	dining := createBucket(t, app, "expense", "Dining")
	groceries := createBucket(t, app, "expense", "Groceries")

	entry := func() string {
		return createTransaction(t, app, []map[string]any{
			{"bucket_id": bank, "amount": -500, "currency": "EUR"},
			{"bucket_id": dining, "amount": 500, "currency": "EUR"},
		})
	}
	a, b, c := entry(), entry(), entry()

	resp := authed(t, app, http.MethodPost, "/api/v1/transactions/categorize", map[string]any{
		"transaction_ids": []string{a, b, c},
		"bucket_id":       groceries,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out map[string]int
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	require.Equal(t, 3, out["categorized"])

	balances := getBalances(t, app)
	require.Equal(t, int64(1500), balances[groceries]["EUR"])
	require.NotContains(t, balances, dining)
}

func TestBulkCategorizeRejectsNonCategory(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")
	txn := createTransaction(t, app, []map[string]any{
		{"bucket_id": bank, "amount": -500, "currency": "EUR"},
		{"bucket_id": groceries, "amount": 500, "currency": "EUR"},
	})

	resp := authed(t, app, http.MethodPost, "/api/v1/transactions/categorize", map[string]any{
		"transaction_ids": []string{txn},
		"bucket_id":       bank,
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestRejectsUnbalancedTransaction(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")

	resp := postTransaction(t, app, []map[string]any{
		{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
		{"bucket_id": groceries, "amount": 500, "currency": "EUR"},
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

// A cross-currency conversion routes through clearing and balances in every
// currency: USD nets to zero, EUR nets to zero.
func TestConversionThroughClearing(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	clearing := clearingBucketID(t, app)

	resp := postTransaction(t, app, []map[string]any{
		{"bucket_id": bank, "amount": -100, "currency": "USD"},
		{"bucket_id": clearing, "amount": 100, "currency": "USD"},
		{"bucket_id": clearing, "amount": -91, "currency": "EUR"},
		{"bucket_id": bank, "amount": 91, "currency": "EUR"},
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
}

// The same conversion but with a mismatched USD leg must be rejected.
func TestRejectsUnbalancedConversion(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	clearing := clearingBucketID(t, app)

	resp := postTransaction(t, app, []map[string]any{
		{"bucket_id": bank, "amount": -100, "currency": "USD"},
		{"bucket_id": clearing, "amount": 99, "currency": "USD"},
		{"bucket_id": clearing, "amount": -91, "currency": "EUR"},
		{"bucket_id": bank, "amount": 91, "currency": "EUR"},
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestRejectsPostingToUnownedBucket(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")

	resp := postTransaction(t, app, []map[string]any{
		{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
		{"bucket_id": "00000000-0000-0000-0000-000000000000", "amount": 1000, "currency": "EUR"},
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestUpdateTransaction(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")
	id := createTransaction(t, app, []map[string]any{
		{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
		{"bucket_id": groceries, "amount": 1000, "currency": "EUR"},
	})

	resp := authed(t, app, http.MethodPatch, "/api/v1/transactions/"+id, map[string]any{
		"date":        "2026-07-05T00:00:00Z",
		"description": "updated",
		"postings": []map[string]any{
			{"bucket_id": bank, "amount": -1500, "currency": "EUR"},
			{"bucket_id": groceries, "amount": 1500, "currency": "EUR"},
		},
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)

	balances := getBalances(t, app)
	require.Equal(t, int64(-1500), balances[bank]["EUR"])
	require.Equal(t, int64(1500), balances[groceries]["EUR"])

	resp = authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	txns := decodeTxns(t, resp)
	require.Len(t, txns, 1)
	require.Equal(t, "updated", txns[0]["description"])
	require.Equal(t, "2026-07-05T00:00:00Z", txns[0]["date"])
}

func TestUpdateRejectsUnbalanced(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")
	id := createTransaction(t, app, []map[string]any{
		{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
		{"bucket_id": groceries, "amount": 1000, "currency": "EUR"},
	})

	resp := authed(t, app, http.MethodPatch, "/api/v1/transactions/"+id, map[string]any{
		"date": "2026-07-05T00:00:00Z", "description": "x",
		"postings": []map[string]any{
			{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
			{"bucket_id": groceries, "amount": 999, "currency": "EUR"},
		},
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestUpdateNotFound(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")

	resp := authed(t, app, http.MethodPatch, "/api/v1/transactions/00000000-0000-0000-0000-000000000000", map[string]any{
		"date": "2026-07-05T00:00:00Z", "description": "x",
		"postings": []map[string]any{
			{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
			{"bucket_id": groceries, "amount": 1000, "currency": "EUR"},
		},
	})
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestDeleteTransaction(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")
	id := createTransaction(t, app, []map[string]any{
		{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
		{"bucket_id": groceries, "amount": 1000, "currency": "EUR"},
	})

	resp := authed(t, app, http.MethodDelete, "/api/v1/transactions/"+id, nil)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)

	resp = authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	txns := decodeTxns(t, resp)
	require.Empty(t, txns)

	require.Empty(t, getBalances(t, app))
}

func TestDeleteNotFound(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	resp := authed(t, app, http.MethodDelete, "/api/v1/transactions/00000000-0000-0000-0000-000000000000", nil)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestTransactionRequiresAuth(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	resp, err := app.client.Get(app.url + "/api/v1/transactions")
	require.NoError(t, err)
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

func decodeTxnPage(t *testing.T, resp *http.Response) ([]map[string]any, map[string]any) {
	t.Helper()
	var body struct {
		Transactions []map[string]any `json:"transactions"`
		NextCursor   map[string]any   `json:"next_cursor"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	return body.Transactions, body.NextCursor
}

func TestTransactionPagination(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")

	const total = data.TransactionPageSize + 1
	for i := 0; i < total; i++ {
		createTransaction(t, app, []map[string]any{
			{"bucket_id": bank, "amount": -1000, "currency": "EUR"},
			{"bucket_id": groceries, "amount": 1000, "currency": "EUR"},
		})
	}

	resp := authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	page1, cursor := decodeTxnPage(t, resp)
	require.Len(t, page1, data.TransactionPageSize)
	require.NotNil(t, cursor)

	url := "/api/v1/transactions?before_date=" + cursor["date"].(string) + "&before_id=" + cursor["id"].(string)
	resp = authed(t, app, http.MethodGet, url, nil)
	page2, cursor := decodeTxnPage(t, resp)
	require.Len(t, page2, total-data.TransactionPageSize)
	require.Nil(t, cursor)

	require.NotEqual(t, page1[len(page1)-1]["id"], page2[0]["id"])
}
