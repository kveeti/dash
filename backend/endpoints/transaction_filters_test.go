package endpoints

import (
	"money/backend/data"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestTransactionFilters(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	cash := createBucket(t, app, "asset", "Cash")
	food := createBucket(t, app, "expense", "Food")
	salary := createBucket(t, app, "income", "Salary")
	person := createBucket(t, app, "person", "Alex")
	old := seedCategorizedTransaction(t, app, time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC), bank, food, -1200, "EUR", "Old food")
	newFood := seedCategorizedTransaction(t, app, time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC), bank, food, -2500, "EUR", "New food")
	income := seedCategorizedTransaction(t, app, time.Date(2026, 2, 2, 12, 0, 0, 0, time.UTC), cash, salary, 5000, "EUR", "Salary")
	personTxn := seedCategorizedTransaction(t, app, time.Date(2026, 2, 3, 12, 0, 0, 0, time.UTC), cash, person, -1000, "EUR", "Alex")
	var userID string
	require.NoError(t, app.d.Users.QueryRow("select owner_user_id from buckets where id=$1", bank).Scan(&userID))
	_, err := app.d.AddPostingTag(t.Context(), userID, []string{newFood.UserPostingID}, "groceries")
	require.NoError(t, err)

	list := func(values url.Values) transactionsResponse {
		path := "/api/v1/transactions?" + values.Encode()
		return decodeTransactionPage(t, authed(t, app, http.MethodGet, path, nil))
	}
	ids := func(page transactionsResponse) []string {
		out := make([]string, len(page.Transactions))
		for i, transaction := range page.Transactions {
			out[i] = transaction.ID
		}
		return out
	}

	require.ElementsMatch(t, []string{old.TransactionID, newFood.TransactionID}, ids(list(url.Values{"category": {food}})))
	require.ElementsMatch(t, []string{income.TransactionID, personTxn.TransactionID}, ids(list(url.Values{"category": {salary, person}})))
	require.Equal(t, []string{newFood.TransactionID}, ids(list(url.Values{"tag": {"groceries"}})))
	require.ElementsMatch(t, []string{old.TransactionID, newFood.TransactionID}, ids(list(url.Values{"account": {bank}, "direction": {"out"}})))
	require.Equal(t, []string{income.TransactionID}, ids(list(url.Values{"direction": {"in"}})))
	require.ElementsMatch(t, []string{old.TransactionID, newFood.TransactionID, personTxn.TransactionID}, ids(list(url.Values{"direction": {"out"}})))
	require.Equal(t, []string{income.TransactionID}, ids(list(url.Values{"account": {cash}, "direction": {"in"}, "currency": {"EUR"}, "amount": {"50.00"}})))
	require.Equal(t, []string{newFood.TransactionID}, ids(list(url.Values{"currency": {"EUR"}, "amount_min": {"20"}, "amount_max": {"30"}})))
	require.Equal(t, []string{newFood.TransactionID}, ids(list(url.Values{"occurred_from": {"2026-02-01T00:00:00Z"}, "occurred_before": {"2026-02-02T00:00:00Z"}})))
	require.Equal(t, []string{newFood.TransactionID}, ids(list(url.Values{"category": {food}, "tag": {"groceries"}, "account": {bank}})))
}

func TestTransactionAccountLegFiltersMatchBothTransferSides(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	checking := createBucket(t, app, "asset", "Checking")
	savings := createBucket(t, app, "asset", "Savings")
	var userID string
	require.NoError(t, app.d.Users.QueryRow("select owner_user_id from buckets where id=$1", checking).Scan(&userID))
	outgoing, incoming := data.NewPrivateID(), data.NewPrivateID()
	occurredAt := time.Date(2026, 2, 3, 12, 0, 0, 0, time.UTC)
	for _, transaction := range []struct {
		id, bucket string
		amount     int64
	}{{outgoing, checking, -1000}, {incoming, savings, 1000}} {
		_, err := app.d.Users.Exec(`insert into transactions(id,owner_user_id,occurred_on,occurred_at,counterparty,description,memo,created_at)
			values($1,$2,$3::date,$4,'','','',now())`, transaction.id, userID, occurredAt.Format(time.DateOnly), occurredAt)
		require.NoError(t, err)
		_, err = app.d.Users.Exec(`insert into postings(id,transaction_id,bucket_id,amount,currency,created_at)
			values($1,$2,$3,$4,'EUR',now())`, data.NewPrivateID(), transaction.id, transaction.bucket, transaction.amount)
		require.NoError(t, err)
	}
	_, err := app.d.Users.Exec(`insert into account_movement_matches(id,owner_user_id,outgoing_transaction_id,incoming_transaction_id,created_at)
		values($1,$2,$3,$4,now())`, data.NewPrivateID(), userID, outgoing, incoming)
	require.NoError(t, err)

	response := decodeTransactionPage(t, authed(t, app, http.MethodGet,
		"/api/v1/transactions?account="+savings+"&direction=in&currency=EUR&amount=10", nil))
	require.Len(t, response.Transactions, 1)
	require.Equal(t, outgoing, response.Transactions[0].ID)
}

func TestTransactionFiltersRejectInvalidValues(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	for _, query := range []string{
		"direction=sideways",
		"category=nope",
		"occurred_from=not-a-time",
		"amount=1&amount_min=1&currency=EUR",
		"amount=1.234&currency=EUR",
		"amount=1&currency=NOPE",
	} {
		response := authed(t, app, http.MethodGet, "/api/v1/transactions?"+query, nil)
		require.Equal(t, http.StatusBadRequest, response.StatusCode, query)
	}
}
