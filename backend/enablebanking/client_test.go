package enablebanking

import (
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func testClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return &Client{origin: server.URL, appID: "app", key: key, http: server.Client(), now: func() time.Time { return time.Unix(1000, 0) }}
}

func TestLongestTransactionsRequiresStartDate(t *testing.T) {
	client := testClient(t, func(http.ResponseWriter, *http.Request) {
		t.Fatal("request sent without a start date")
	})
	_, err := client.LongestTransactions(t.Context(), "account", "", "")
	require.EqualError(t, err, "transaction start date is required")
}

func TestLongestTransactionsSendsStartDateAndContinuation(t *testing.T) {
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "longest", r.URL.Query().Get("strategy"))
		require.Equal(t, "2024-08-10", r.URL.Query().Get("date_from"))
		require.Empty(t, r.URL.Query().Get("date_to"))
		require.Equal(t, "next", r.URL.Query().Get("continuation_key"))
		_, _ = w.Write([]byte(`{"transactions":[],"continuation_key":""}`))
	})
	_, err := client.LongestTransactions(t.Context(), "account", "2024-08-10", "next")
	require.NoError(t, err)
}

func TestAPIError(t *testing.T) {
	client := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"error":"EXPIRED_SESSION","message":"expired"}`))
	})
	_, err := client.LongestTransactions(t.Context(), "account", "2026-07-01", "")
	var apiError *APIError
	require.ErrorAs(t, err, &apiError)
	require.Equal(t, "EXPIRED_SESSION", apiError.Code)
}
