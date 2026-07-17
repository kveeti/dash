package endpoints

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"money/backend/data"

	"github.com/stretchr/testify/require"
)

type inboxRow struct {
	ID           string `json:"id"`
	Date         string `json:"date"`
	Amount       int64  `json:"amount"`
	Currency     string `json:"currency"`
	Counterparty string `json:"counterparty"`
	Description  string `json:"description"`
	Account      string `json:"account"`
	Kind         string `json:"kind"`
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

func categorizeInboxTransactions(t *testing.T, app *testApp, rowIDs []string, bucketID string) []string {
	t.Helper()
	resp := authed(t, app, http.MethodPost, "/api/v1/inbox/categorize", map[string]any{
		"row_ids":   rowIDs,
		"bucket_id": bucketID,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out struct {
		Categorized    int             `json:"categorized"`
		TransactionIDs json.RawMessage `json:"transaction_ids"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	require.Nil(t, out.TransactionIDs)

	rows, err := app.d.Users.Query("select transaction_id from import_rows where id = any($1::uuid[]) order by id", rowIDs)
	require.NoError(t, err)
	defer rows.Close()
	var transactionIDs []string
	for rows.Next() {
		var id string
		require.NoError(t, rows.Scan(&id))
		transactionIDs = append(transactionIDs, id)
	}
	require.NoError(t, rows.Err())
	require.Equal(t, out.Categorized, len(transactionIDs))
	return transactionIDs
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
	var out struct {
		Categorized int `json:"categorized"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out.Categorized
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

func TestRemoveTransactionsRestoresImportedRows(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")
	doImport(t, app, bank, nordeaHeader+
		nordeaRow("2026/07/01", "-12,34", "K-Market", "Groceries")+
		nordeaRow("2026/07/02", "-5,00", "Cafe", "Coffee"))

	rows := getInbox(t, app, "")
	rowIDs := []string{rows[0].ID, rows[1].ID}
	transactionIDs := categorizeInboxTransactions(t, app, rowIDs, groceries)
	require.Len(t, transactionIDs, 2)

	resp := authed(t, app, http.MethodPost, "/api/v1/transactions/tags", map[string]any{
		"transaction_ids": []string{transactionIDs[0]}, "tag": "temporary",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)

	resp = authed(t, app, http.MethodDelete, "/api/v1/transactions", map[string]any{
		"transaction_ids": transactionIDs,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var removed struct {
		Removed  int `json:"removed"`
		Restored int `json:"restored"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&removed))
	require.Equal(t, 2, removed.Removed)
	require.Equal(t, 2, removed.Restored)
	require.Len(t, getInbox(t, app, ""), 2)
	require.Empty(t, decodeTxns(t, authed(t, app, http.MethodGet, "/api/v1/transactions", nil)))
	require.Empty(t, getBalances(t, app))

	resp = authed(t, app, http.MethodGet, "/api/v1/tags", nil)
	var tags struct {
		Tags []string `json:"tags"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&tags))
	require.Empty(t, tags.Tags)
}

func TestRemoveMatchedTransactionRestoresBothRows(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	checking := createBucket(t, app, "asset", "Checking")
	savings := createBucket(t, app, "asset", "Savings")
	doImport(t, app, checking, nordeaHeader+nordeaRow("2026/07/01", "-500,00", "Transfer", "Savings"))
	doImport(t, app, savings, nordeaHeader+nordeaRow("2026/07/02", "500,00", "Transfer", "Checking"))

	rows := getInbox(t, app, "")
	resp := authed(t, app, http.MethodPost, "/api/v1/inbox/"+rows[0].ID+"/match", map[string]any{"match_id": rows[1].ID})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var matched struct {
		Matched       bool            `json:"matched"`
		TransactionID json.RawMessage `json:"transaction_id"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&matched))
	require.True(t, matched.Matched)
	require.Nil(t, matched.TransactionID)
	var transactionID string
	require.NoError(t, app.d.Users.QueryRow("select transaction_id from import_rows where id = $1", rows[0].ID).Scan(&transactionID))

	resp = authed(t, app, http.MethodDelete, "/api/v1/transactions", map[string]any{
		"transaction_ids": []string{transactionID},
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Len(t, getInbox(t, app, ""), 2)
	require.Empty(t, decodeTxns(t, authed(t, app, http.MethodGet, "/api/v1/transactions", nil)))
}

func TestRestoreInboxRows(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	groceries := createBucket(t, app, "expense", "Groceries")
	doImport(t, app, bank, nordeaHeader+nordeaRow("2026/07/01", "-12,34", "K-Market", "Groceries"))

	row := getInbox(t, app, "")[0]
	transactionIDs := categorizeInboxTransactions(t, app, []string{row.ID}, groceries)
	require.Len(t, transactionIDs, 1)
	transactionID := transactionIDs[0]
	resp := authed(t, app, http.MethodPost, "/api/v1/transactions/tags", map[string]any{
		"transaction_ids": transactionIDs, "tag": "temporary",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)

	resp = authed(t, app, http.MethodPost, "/api/v1/inbox/restore", map[string]any{"row_ids": []string{row.ID}})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out struct {
		Restored int `json:"restored"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	require.Equal(t, 1, out.Restored)
	require.Len(t, getInbox(t, app, ""), 1)
	require.Empty(t, decodeTxns(t, authed(t, app, http.MethodGet, "/api/v1/transactions", nil)))

	var transactionDeletes, postingDeletes, tagDeletes, rowUpdates int
	require.NoError(t, app.d.Users.QueryRow(`select count(*) from audit_logs
		where table_name = 'transactions' and operation = 'delete' and row_id = $1`, transactionID).Scan(&transactionDeletes))
	require.NoError(t, app.d.Users.QueryRow(`select count(*) from audit_logs
		where table_name = 'postings' and operation = 'delete' and before->>'transaction_id' = $1`, transactionID).Scan(&postingDeletes))
	require.NoError(t, app.d.Users.QueryRow(`select count(*) from audit_logs
		where table_name = 'transaction_tags' and operation = 'delete' and before->>'transaction_id' = $1`, transactionID).Scan(&tagDeletes))
	require.NoError(t, app.d.Users.QueryRow(`select count(*) from audit_logs
		where table_name = 'import_rows' and operation = 'update' and row_id = $1`, row.ID).Scan(&rowUpdates))
	require.Equal(t, 1, transactionDeletes)
	require.Equal(t, 2, postingDeletes)
	require.Equal(t, 1, tagDeletes)
	require.Equal(t, 2, rowUpdates)
}

func TestRestoreInboxMatchReturnsBothRows(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	checking := createBucket(t, app, "asset", "Checking")
	savings := createBucket(t, app, "asset", "Savings")
	doImport(t, app, checking, nordeaHeader+nordeaRow("2026/07/01", "-500,00", "Transfer", "Savings"))
	doImport(t, app, savings, nordeaHeader+nordeaRow("2026/07/02", "500,00", "Transfer", "Checking"))

	rows := getInbox(t, app, "")
	resp := authed(t, app, http.MethodPost, "/api/v1/inbox/"+rows[0].ID+"/match", map[string]any{"match_id": rows[1].ID})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp = authed(t, app, http.MethodPost, "/api/v1/inbox/restore", map[string]any{"row_ids": []string{rows[0].ID}})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Len(t, getInbox(t, app, ""), 2)
}

func TestRestoreInboxRejectsAnotherUsersRows(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	otherUserID := data.NewPrivateID()
	require.NoError(t, app.d.CreateUser(context.Background(), data.User{
		ID: otherUserID, Subject: "restore-other", Issuer: "test", Email: "restore-other@example.com", CreatedAt: time.Now(),
	}))
	assetID := data.NewPrivateID()
	categoryID := data.NewPrivateID()
	require.NoError(t, app.d.CreateBucket(context.Background(), data.Bucket{
		ID: assetID, OwnerUserID: otherUserID, Kind: data.KindAsset, Name: "Other asset", CreatedAt: time.Now(),
	}))
	require.NoError(t, app.d.CreateBucket(context.Background(), data.Bucket{
		ID: categoryID, OwnerUserID: otherUserID, Kind: data.KindExpense, Name: "Other expense", CreatedAt: time.Now(),
	}))
	batchID := data.NewPrivateID()
	rowID := data.NewPrivateID()
	_, err := app.d.Users.Exec(`insert into import_batches
		(id, user_id, bucket_id, source, filename, timezone, created_at, status)
		values ($1, $2, $3, 'nordea', 'other.csv', 'Europe/Helsinki', now(), 'done')`, batchID, otherUserID, assetID)
	require.NoError(t, err)
	_, err = app.d.Users.Exec(`insert into import_rows
		(id, batch_id, date, amount, currency, raw_description, raw, dedup_hash, status)
		values ($1, $2, '2026-06-30T21:00:00Z', -500, 'EUR', '', '{"payee":"Other row"}', $3, 'pending')`, rowID, batchID, rowID)
	require.NoError(t, err)
	categorized, err := app.d.CategorizeInboxRows(context.Background(), otherUserID, []string{rowID}, categoryID)
	require.NoError(t, err)
	require.Equal(t, 1, categorized)

	resp := authed(t, app, http.MethodPost, "/api/v1/inbox/restore", map[string]any{"row_ids": []string{rowID}})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var status string
	var transactionID string
	require.NoError(t, app.d.Users.QueryRow("select status, transaction_id from import_rows where id = $1", rowID).Scan(&status, &transactionID))
	require.Equal(t, "categorized", status)
	require.NotEmpty(t, transactionID)
}

func TestInboxCategorizeCreatesBucket(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	doImport(t, app, bank, nordeaHeader+nordeaRow("2026/07/01", "-12,34", "K-Market", "Groceries"))

	rows := getInbox(t, app, "")
	resp := authed(t, app, http.MethodPost, "/api/v1/inbox/categorize", map[string]any{
		"row_ids": []string{rows[0].ID},
		"bucket":  map[string]any{"kind": "expense", "name": "Groceries"},
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out struct {
		Categorized int            `json:"categorized"`
		Bucket      bucketResponse `json:"bucket"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	require.Equal(t, 1, out.Categorized)
	require.Equal(t, data.KindExpense, out.Bucket.Kind)
	require.Equal(t, "Groceries", out.Bucket.Name)

	balances := getBalances(t, app)
	require.Equal(t, int64(-1234), balances[bank]["EUR"])
	require.Equal(t, int64(1234), balances[out.Bucket.ID]["EUR"])
}

func TestInboxCategorizeDoesNotCreateBucketWithoutRows(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	resp := authed(t, app, http.MethodPost, "/api/v1/inbox/categorize", map[string]any{
		"row_ids": []string{data.NewPrivateID()},
		"bucket":  map[string]any{"kind": "expense", "name": "Groceries"},
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out struct {
		Categorized int             `json:"categorized"`
		Bucket      *bucketResponse `json:"bucket"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	require.Zero(t, out.Categorized)
	require.Nil(t, out.Bucket)

	buckets := decodeBuckets(t, authed(t, app, http.MethodGet, "/api/v1/buckets", nil))
	require.Len(t, buckets, 1)
}

func TestInboxCategorizeRejectsInvalidTarget(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	for _, body := range []map[string]any{
		{"row_ids": []string{data.NewPrivateID()}},
		{"row_ids": []string{data.NewPrivateID()}, "bucket_id": data.NewPrivateID(), "bucket": map[string]any{"kind": "expense", "name": "Food"}},
		{"row_ids": []string{data.NewPrivateID()}, "bucket": map[string]any{"kind": "asset", "name": "Bank"}},
	} {
		resp := authed(t, app, http.MethodPost, "/api/v1/inbox/categorize", body)
		require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	}
}

func TestInboxCategorizeToPerson(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	bob := createBucket(t, app, "person", "Bob")
	doImport(t, app, bank, nordeaHeader+nordeaRow("2026/07/01", "-50,00", "Restaurant", "Dinner"))

	rows := getInbox(t, app, "")
	require.Len(t, rows, 1)
	require.Equal(t, 1, categorizeInbox(t, app, []string{rows[0].ID}, bob))

	balances := getBalances(t, app)
	require.Equal(t, int64(-5000), balances[bank]["EUR"])
	require.Equal(t, int64(5000), balances[bob]["EUR"])
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

func TestMatchInboxTransfer(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	checking := createBucket(t, app, "asset", "Checking")
	savings := createBucket(t, app, "asset", "Savings")
	doImport(t, app, checking, nordeaHeader+nordeaRow("2026/07/01", "-500,00", "Transfer", "Savings"))
	doImport(t, app, savings, nordeaHeader+nordeaRow("2026/07/02", "500,00", "Transfer", "Checking"))

	rows := getInbox(t, app, "")
	require.Len(t, rows, 2)
	var sourceID, matchID string
	for _, row := range rows {
		if row.Amount < 0 {
			sourceID = row.ID
		} else {
			matchID = row.ID
		}
	}

	resp := authed(t, app, http.MethodGet, "/api/v1/inbox/"+sourceID+"/matches", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var suggestions struct {
		Matches []inboxRow `json:"matches"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&suggestions))
	require.Len(t, suggestions.Matches, 1)
	require.Equal(t, matchID, suggestions.Matches[0].ID)

	resp = authed(t, app, http.MethodGet, "/api/v1/inbox/"+matchID+"/matches", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&suggestions))
	require.Len(t, suggestions.Matches, 1)
	require.Equal(t, sourceID, suggestions.Matches[0].ID)

	resp = authed(t, app, http.MethodPost, "/api/v1/inbox/"+sourceID+"/match", map[string]any{"match_id": matchID})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Empty(t, getInbox(t, app, ""))

	resp = authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	require.Len(t, decodeTxns(t, resp), 1)
	balances := getBalances(t, app)
	require.Equal(t, int64(-50000), balances[checking]["EUR"])
	require.Equal(t, int64(50000), balances[savings]["EUR"])
}

func TestMatchInboxExchange(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	doImport(t, app, bank, nordeaHeader+
		nordeaRow("2026/07/01", "-100,00", "Sold EUR", "Exchange")+
		nordeaRowCurrency("2026/07/01", "430,00", "Bought PLN", "Exchange", "PLN"))

	rows := inboxByParty(getInbox(t, app, ""))
	source, match := rows["Sold EUR"], rows["Bought PLN"]
	resp := authed(t, app, http.MethodGet, "/api/v1/inbox/"+source.ID+"/matches", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var suggestions struct {
		Matches []inboxRow `json:"matches"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&suggestions))
	require.Len(t, suggestions.Matches, 1)
	require.Equal(t, match.ID, suggestions.Matches[0].ID)
	require.Equal(t, "exchange", suggestions.Matches[0].Kind)

	resp = authed(t, app, http.MethodPost, "/api/v1/inbox/"+source.ID+"/match", map[string]any{"match_id": match.ID})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Empty(t, getInbox(t, app, ""))

	balances := getBalances(t, app)
	clearing := clearingBucketID(t, app)
	require.Equal(t, int64(-10000), balances[bank]["EUR"])
	require.Equal(t, int64(43000), balances[bank]["PLN"])
	require.Equal(t, int64(10000), balances[clearing]["EUR"])
	require.Equal(t, int64(-43000), balances[clearing]["PLN"])
}

func TestExchangeMatchesRankByValueUsingCurrencyExponent(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	_, err := app.d.Users.Exec("insert into rates (date, currency, rate) values ('2026-07-01', 'EUR', 1), ('2026-07-01', 'JPY', 200)")
	require.NoError(t, err)
	doImport(t, app, bank, nordeaHeader+
		nordeaRow("2026/07/01", "-100,00", "Sold EUR", "Exchange")+
		nordeaRowCurrency("2026/07/01", "200", "Wrong JPY", "Exchange", "JPY")+
		nordeaRowCurrency("2026/07/01", "20000", "Bought JPY", "Exchange", "JPY"))

	rows := inboxByParty(getInbox(t, app, ""))
	resp := authed(t, app, http.MethodGet, "/api/v1/inbox/"+rows["Sold EUR"].ID+"/matches", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var suggestions struct {
		Matches []inboxRow `json:"matches"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&suggestions))
	require.Len(t, suggestions.Matches, 2)
	require.Equal(t, rows["Bought JPY"].ID, suggestions.Matches[0].ID)
}

func TestExchangeMatchesPutMissingRatesLast(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	_, err := app.d.Users.Exec("insert into rates (date, currency, rate) values ('2026-07-01', 'EUR', 1), ('2026-07-01', 'JPY', 200)")
	require.NoError(t, err)
	doImport(t, app, bank, nordeaHeader+
		nordeaRow("2026/07/01", "-100,00", "Sold EUR", "Exchange")+
		nordeaRowCurrency("2026/07/03", "20000", "Bought JPY", "Exchange", "JPY")+
		nordeaRowCurrency("2026/07/01", "430,00", "Bought PLN", "Exchange", "PLN"))

	rows := inboxByParty(getInbox(t, app, ""))
	resp := authed(t, app, http.MethodGet, "/api/v1/inbox/"+rows["Sold EUR"].ID+"/matches", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var suggestions struct {
		Matches []inboxRow `json:"matches"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&suggestions))
	require.Len(t, suggestions.Matches, 2)
	require.Equal(t, rows["Bought JPY"].ID, suggestions.Matches[0].ID)
	require.Equal(t, rows["Bought PLN"].ID, suggestions.Matches[1].ID)
}

func TestMatchInboxRejectsInvalidPairsWithoutWriting(t *testing.T) {
	tests := []struct {
		name           string
		firstDate      string
		firstAmount    string
		firstCurrency  string
		secondDate     string
		secondAmount   string
		secondCurrency string
		sameAccount    bool
	}{
		{"same-sign exchange", "2026/07/01", "-5,00", "EUR", "2026/07/01", "-4,00", "PLN", false},
		{"unequal transfer", "2026/07/01", "-5,00", "EUR", "2026/07/01", "4,00", "EUR", false},
		{"same-account transfer", "2026/07/01", "-5,00", "EUR", "2026/07/01", "5,00", "EUR", true},
		{"too far apart", "2026/07/01", "-5,00", "EUR", "2026/07/09", "5,00", "EUR", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
			firstAccount := createBucket(t, app, "asset", "First")
			secondAccount := firstAccount
			if !tt.sameAccount {
				secondAccount = createBucket(t, app, "asset", "Second")
			}
			doImport(t, app, firstAccount, nordeaHeader+nordeaRowCurrency(tt.firstDate, tt.firstAmount, "First row", "", tt.firstCurrency))
			doImport(t, app, secondAccount, nordeaHeader+nordeaRowCurrency(tt.secondDate, tt.secondAmount, "Second row", "", tt.secondCurrency))
			rows := inboxByParty(getInbox(t, app, ""))

			resp := authed(t, app, http.MethodPost, "/api/v1/inbox/"+rows["First row"].ID+"/match", map[string]any{"match_id": rows["Second row"].ID})
			require.Equal(t, http.StatusBadRequest, resp.StatusCode)
			require.Len(t, getInbox(t, app, ""), 2)

			resp = authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
			require.Empty(t, decodeTxns(t, resp))
		})
	}
}

func TestMatchInboxUsesImportCalendarDates(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	checking := createBucket(t, app, "asset", "Checking")
	savings := createBucket(t, app, "asset", "Savings")
	doImport(t, app, checking, nordeaHeader+nordeaRow("2026/10/19", "-5,00", "Source", ""))
	doImport(t, app, savings, nordeaHeader+
		nordeaRow("2026/10/26", "5,00", "Seven days", "")+
		nordeaRow("2026/10/27", "5,00", "Eight days", ""))

	rows := inboxByParty(getInbox(t, app, ""))
	resp := authed(t, app, http.MethodGet, "/api/v1/inbox/"+rows["Source"].ID+"/matches", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var suggestions struct {
		Matches []inboxRow `json:"matches"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&suggestions))
	require.Len(t, suggestions.Matches, 1)
	require.Equal(t, rows["Seven days"].ID, suggestions.Matches[0].ID)

	resp = authed(t, app, http.MethodPost, "/api/v1/inbox/"+rows["Source"].ID+"/match", map[string]any{"match_id": rows["Seven days"].ID})
	require.Equal(t, http.StatusOK, resp.StatusCode)
}

func TestMatchInboxRejectsAnotherUsersRow(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	ownAccount := createBucket(t, app, "asset", "Own")
	doImport(t, app, ownAccount, nordeaHeader+nordeaRow("2026/07/01", "-5,00", "Own row", ""))
	ownRow := getInbox(t, app, "")[0]

	otherUserID := data.NewPrivateID()
	require.NoError(t, app.d.CreateUser(context.Background(), data.User{
		ID: otherUserID, Subject: "other", Issuer: "test", Email: "other@example.com", CreatedAt: time.Now(),
	}))
	otherAccountID := data.NewPrivateID()
	require.NoError(t, app.d.CreateBucket(context.Background(), data.Bucket{
		ID: otherAccountID, OwnerUserID: otherUserID, Kind: data.KindAsset, Name: "Other", CreatedAt: time.Now(),
	}))
	otherBatchID := data.NewPrivateID()
	otherRowID := data.NewPrivateID()
	_, err := app.d.Users.Exec(`insert into import_batches
		(id, user_id, bucket_id, source, filename, timezone, created_at, status)
		values ($1, $2, $3, 'nordea', 'other.csv', 'Europe/Helsinki', now(), 'done')`,
		otherBatchID, otherUserID, otherAccountID)
	require.NoError(t, err)
	_, err = app.d.Users.Exec(`insert into import_rows
		(id, batch_id, date, amount, currency, raw_description, raw, dedup_hash, status)
		values ($1, $2, '2026-06-30T21:00:00Z', 500, 'EUR', '', '{"payee":"Other row"}', $3, 'pending')`,
		otherRowID, otherBatchID, otherRowID)
	require.NoError(t, err)

	resp := authed(t, app, http.MethodPost, "/api/v1/inbox/"+ownRow.ID+"/match", map[string]any{"match_id": otherRowID})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.Len(t, getInbox(t, app, ""), 1)

	var otherStatus string
	require.NoError(t, app.d.Users.QueryRow("select status from import_rows where id = $1", otherRowID).Scan(&otherStatus))
	require.Equal(t, "pending", otherStatus)
}

func TestConcurrentInboxMatchesOnlyUseSourceOnce(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	checking := createBucket(t, app, "asset", "Checking")
	savings := createBucket(t, app, "asset", "Savings")
	doImport(t, app, checking, nordeaHeader+nordeaRow("2026/07/01", "-5,00", "Source", ""))
	doImport(t, app, savings, nordeaHeader+
		nordeaRow("2026/07/01", "5,00", "Candidate one", "")+
		nordeaRow("2026/07/01", "5,00", "Candidate two", ""))
	rows := inboxByParty(getInbox(t, app, ""))

	var userID string
	require.NoError(t, app.d.Users.QueryRow("select id from users limit 1").Scan(&userID))
	results := make(chan error, 2)
	go func() {
		results <- app.d.MatchInboxRows(context.Background(), userID, rows["Source"].ID, rows["Candidate one"].ID)
	}()
	go func() {
		results <- app.d.MatchInboxRows(context.Background(), userID, rows["Source"].ID, rows["Candidate two"].ID)
	}()

	successes := 0
	for range 2 {
		err := <-results
		if err == nil {
			successes++
		} else {
			require.True(t, errors.Is(err, data.ErrInvalidPostings), err)
		}
	}
	require.Equal(t, 1, successes)
	require.Len(t, getInbox(t, app, ""), 1)
	resp := authed(t, app, http.MethodGet, "/api/v1/transactions", nil)
	require.Len(t, decodeTxns(t, resp), 1)
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
