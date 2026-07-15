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
