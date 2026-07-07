package endpoints

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

type inboxRow struct {
	ID           string `json:"id"`
	Date         string `json:"date"`
	Amount       int64  `json:"amount"`
	Currency     string `json:"currency"`
	Counterparty string `json:"counterparty"`
	Description  string `json:"description"`
}

func getInbox(t *testing.T, app *testApp, query string) []inboxRow {
	t.Helper()
	resp := authed(t, app, http.MethodGet, "/api/v1/inbox"+query, nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out struct {
		Rows []inboxRow `json:"rows"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out.Rows
}

func inboxByParty(rows []inboxRow) map[string]inboxRow {
	m := map[string]inboxRow{}
	for _, r := range rows {
		m[r.Counterparty] = r
	}
	return m
}

func categorizeInbox(t *testing.T, app *testApp, rowIDs []string, bucketID string) int {
	t.Helper()
	resp := authed(t, app, http.MethodPost, "/api/v1/inbox/categorize", map[string]any{
		"row_ids":   rowIDs,
		"bucket_id": bucketID,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out map[string]int
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out["categorized"]
}

// Categorizing pending inbox rows creates ledger transactions with an asset leg on
// the import bucket and a category leg on the chosen bucket.
func TestInboxCategorizeCreatesTransactions(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")

	csv := nordeaHeader +
		nordeaRow("2026/07/01", "-12,34", "K-Market", "Groceries") +
		nordeaRow("2026/07/02", "100,00", "Employer", "Salary")
	doImport(t, app, bank, csv)

	rows := getInbox(t, app, "")
	require.Len(t, rows, 2)

	ids := []string{rows[0].ID, rows[1].ID}
	require.Equal(t, 2, categorizeInbox(t, app, ids, groceries))

	require.Empty(t, getInbox(t, app, ""))

	resp := authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	require.Len(t, decodeTxns(t, resp), 2)

	balances := getBalances(t, app)
	require.Equal(t, int64(-1234+10000), balances[bank]["EUR"])
	require.Equal(t, int64(1234-10000), balances[groceries]["EUR"])
}

func TestInboxCategorizeRejectsNonCategory(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	doImport(t, app, bank, nordeaHeader+nordeaRow("2026/07/01", "-5,00", "Cafe", "Coffee"))

	rows := getInbox(t, app, "")
	require.Len(t, rows, 1)

	resp := authed(t, app, http.MethodPost, "/api/v1/inbox/categorize", map[string]any{
		"row_ids":   []string{rows[0].ID},
		"bucket_id": bank,
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestInboxSearch(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	doImport(t, app, bank, nordeaHeader+
		nordeaRow("2026/07/01", "-1,00", "K-Market Kamppi", "shop")+
		nordeaRow("2026/07/02", "-2,00", "Shell", "fuel"))

	rows := getInbox(t, app, "?q=market")
	require.Len(t, rows, 1)
	require.Equal(t, "K-Market Kamppi", rows[0].Counterparty)
}
