package endpoints

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"money/backend/data"

	"github.com/stretchr/testify/require"
)

type seededTransaction struct {
	RowID         string
	TransactionID string
	ImportedID    string
	UserPostingID string
}

func decodeTransactionPage(t *testing.T, resp *http.Response) transactionsResponse {
	t.Helper()
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out transactionsResponse
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out
}

func decodeTxns(t *testing.T, resp *http.Response) []map[string]any {
	t.Helper()
	var body struct {
		Transactions []map[string]any `json:"transactions"`
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

func seedCategorizedTransaction(t *testing.T, app *testApp, occurredAt time.Time, accountID, categoryID string, amount int64, currency, counterparty string) seededTransaction {
	t.Helper()
	var userID string
	require.NoError(t, app.d.Users.QueryRow("select owner_user_id from buckets where id=$1", accountID).Scan(&userID))

	batchID := data.NewPrivateID()
	rowID := data.NewPrivateID()
	_, err := app.d.Users.Exec(`insert into import_batches(id,user_id,bucket_id,source,filename,timezone,created_at,status)
		values($1,$2,$3,'csv','test.csv','UTC',now(),'done')`, batchID, userID, accountID)
	require.NoError(t, err)
	_, err = app.d.Users.Exec(`insert into import_rows(id,batch_id,occurred_on,occurred_at,amount,currency,counterparty,note,dedup_hash,status)
		values($1,$2,$3::date,$4,$5,$6,$7,'',$1::uuid::text,'pending')`,
		rowID, batchID, occurredAt.Format(time.DateOnly), occurredAt, amount, currency, counterparty)
	require.NoError(t, err)

	n, err := app.d.CategorizeInboxRows(t.Context(), userID, []string{rowID}, categoryID)
	require.NoError(t, err)
	require.Equal(t, 1, n)

	var out seededTransaction
	out.RowID = rowID
	require.NoError(t, app.d.Users.QueryRow(`select p.transaction_id,p.id,u.id
		from postings p join postings u on u.transaction_id=p.transaction_id and u.import_row_id is null
		where p.import_row_id=$1`, rowID).Scan(&out.TransactionID, &out.ImportedID, &out.UserPostingID))
	return out
}

func getTransaction(t *testing.T, app *testApp, id string) transactionResponse {
	t.Helper()
	resp := authed(t, app, http.MethodGet, "/api/v1/transactions/"+id, nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out transactionResponse
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out
}

func postingByID(t *testing.T, postings []postingResponse, id string) postingResponse {
	t.Helper()
	for _, posting := range postings {
		if posting.ID == id {
			return posting
		}
	}
	t.Fatalf("posting %s not found", id)
	return postingResponse{}
}

func TestManualTransactionCreationIsRemoved(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	resp := authed(t, app, http.MethodPost, "/api/v1/transactions", map[string]any{})
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestTransactionListAndDetailUseImportedSource(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	food := createBucket(t, app, "expense", "Food")
	seed := seedCategorizedTransaction(t, app, time.Date(2026, 7, 1, 12, 30, 0, 0, time.UTC), bank, food, -1234, "EUR", "Market")

	page := decodeTransactionPage(t, authed(t, app, http.MethodGet, "/api/v1/transactions", nil))
	require.Len(t, page.Transactions, 1)
	require.Equal(t, seed.TransactionID, page.Transactions[0].ID)
	require.Equal(t, "2026-07-01", page.Transactions[0].OccurredOn)
	require.NotNil(t, page.Transactions[0].OccurredAt)
	require.Equal(t, "2026-07-01T12:30:00Z", *page.Transactions[0].OccurredAt)
	require.Len(t, page.Transactions[0].Postings, 2)
	require.True(t, postingByID(t, page.Transactions[0].Postings, seed.ImportedID).Imported)
	require.False(t, postingByID(t, page.Transactions[0].Postings, seed.UserPostingID).Imported)

	detail := getTransaction(t, app, seed.TransactionID)
	require.Equal(t, "Market", detail.Counterparty)
	require.Equal(t, seed.TransactionID, detail.ID)
}

func TestPatchTransactionOnlyChangesMemo(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	food := createBucket(t, app, "expense", "Food")
	seed := seedCategorizedTransaction(t, app, time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC), bank, food, -1000, "EUR", "Market")

	resp := authed(t, app, http.MethodPatch, "/api/v1/transactions/"+seed.TransactionID, map[string]any{"memo": "Work"})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var updated transactionResponse
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&updated))
	require.Equal(t, "Market", updated.Counterparty)
	require.Empty(t, updated.Description)
	require.Equal(t, "Work", updated.Memo)
	require.Equal(t, "2026-07-01", updated.OccurredOn)
	require.NotNil(t, updated.OccurredAt)
	require.Equal(t, "2026-07-01T00:00:00Z", *updated.OccurredAt)

	resp = authed(t, app, http.MethodPatch, "/api/v1/transactions/"+seed.TransactionID, map[string]any{
		"counterparty": "Shop", "description": "Lunch", "occurred_at": "2030-01-01T00:00:00Z",
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	unchanged := getTransaction(t, app, seed.TransactionID)
	require.Equal(t, "Market", unchanged.Counterparty)
	require.Empty(t, unchanged.Description)
	require.Equal(t, "2026-07-01", unchanged.OccurredOn)
	require.NotNil(t, unchanged.OccurredAt)
	require.Equal(t, "2026-07-01T00:00:00Z", *unchanged.OccurredAt)
}

func TestPatchPostingOnlyChangesSingleTransactionCategory(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	food := createBucket(t, app, "expense", "Food")
	travel := createBucket(t, app, "expense", "Travel")
	seed := seedCategorizedTransaction(t, app, time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC), bank, food, -1000, "EUR", "Market")

	resp := authed(t, app, http.MethodPatch, "/api/v1/postings/"+seed.UserPostingID, map[string]any{"bucket_id": travel})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	posting := postingByID(t, getTransaction(t, app, seed.TransactionID).Postings, seed.UserPostingID)
	require.Equal(t, travel, posting.Bucket.ID)
	require.Empty(t, posting.Memo)
	require.Nil(t, posting.StatsDate)

	resp = authed(t, app, http.MethodPatch, "/api/v1/postings/"+seed.UserPostingID, map[string]any{
		"bucket_id": food, "memo": "Train", "stats_date": "2026-06-30",
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	posting = postingByID(t, getTransaction(t, app, seed.TransactionID).Postings, seed.UserPostingID)
	require.Equal(t, travel, posting.Bucket.ID)
	require.Empty(t, posting.Memo)
	require.Nil(t, posting.StatsDate)

	resp = authed(t, app, http.MethodPatch, "/api/v1/postings/"+seed.ImportedID, map[string]any{"bucket_id": travel})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestPostingTagsListFilterAndRemove(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	food := createBucket(t, app, "expense", "Food")
	seed := seedCategorizedTransaction(t, app, time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC), bank, food, -1000, "EUR", "Market")

	resp := authed(t, app, http.MethodPost, "/api/v1/transactions/tags", map[string]any{
		"posting_ids": []string{seed.ImportedID}, "tag": "bank-fact",
	})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)

	resp = authed(t, app, http.MethodPost, "/api/v1/transactions/tags", map[string]any{
		"posting_ids": []string{seed.UserPostingID}, "tag": "  Holiday  ",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	posting := postingByID(t, getTransaction(t, app, seed.TransactionID).Postings, seed.UserPostingID)
	require.Equal(t, []string{"holiday"}, posting.Tags)

	page := decodeTransactionPage(t, authed(t, app, http.MethodGet, "/api/v1/transactions?tag=holiday", nil))
	require.Len(t, page.Transactions, 1)
	page = decodeTransactionPage(t, authed(t, app, http.MethodGet, "/api/v1/transactions?tag=other", nil))
	require.Empty(t, page.Transactions)

	resp = authed(t, app, http.MethodDelete, "/api/v1/transactions/tags", map[string]any{
		"posting_ids": []string{seed.UserPostingID}, "tag": "HOLIDAY",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Empty(t, postingByID(t, getTransaction(t, app, seed.TransactionID).Postings, seed.UserPostingID).Tags)
}

func TestBulkCategorizeMovesSingleCategoryPosting(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	food := createBucket(t, app, "expense", "Food")
	travel := createBucket(t, app, "expense", "Travel")
	seed := seedCategorizedTransaction(t, app, time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC), bank, food, -1000, "EUR", "Market")

	resp := authed(t, app, http.MethodPost, "/api/v1/transactions/categorize", map[string]any{
		"transaction_ids": []string{seed.TransactionID}, "bucket_id": travel,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var out map[string]int
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	require.Equal(t, 1, out["categorized"])
	require.Equal(t, travel, postingByID(t, getTransaction(t, app, seed.TransactionID).Postings, seed.UserPostingID).Bucket.ID)
}

func TestSplitKeepsSurvivingPostingIDMetadataAndTags(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	food := createBucket(t, app, "expense", "Food")
	travel := createBucket(t, app, "expense", "Travel")
	seed := seedCategorizedTransaction(t, app, time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC), bank, food, -1000, "EUR", "Market")

	resp := authed(t, app, http.MethodPost, "/api/v1/transactions/tags", map[string]any{
		"posting_ids": []string{seed.UserPostingID}, "tag": "shared",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)

	resp = authed(t, app, http.MethodPut, "/api/v1/transactions/"+seed.TransactionID+"/postings", map[string]any{"postings": []map[string]any{
		{"id": seed.UserPostingID, "bucket_id": food, "amount": 600, "currency": "EUR", "memo": "kept", "stats_date": "2026-06-30"},
		{"bucket_id": travel, "amount": 400, "currency": "EUR"},
	}})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var split transactionResponse
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&split))
	require.Len(t, split.Postings, 3)
	survivor := postingByID(t, split.Postings, seed.UserPostingID)
	require.Equal(t, int64(600), survivor.Amount)
	require.Equal(t, "kept", survivor.Memo)
	require.Equal(t, []string{"shared"}, survivor.Tags)
	require.Equal(t, "2026-06-30", *survivor.StatsDate)

	resp = authed(t, app, http.MethodPut, "/api/v1/transactions/"+seed.TransactionID+"/postings", map[string]any{"postings": []map[string]any{
		{"id": seed.UserPostingID, "bucket_id": food, "amount": 500, "currency": "EUR"},
	}})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	require.Len(t, getTransaction(t, app, seed.TransactionID).Postings, 3)

	var updates, inserts int
	require.NoError(t, app.d.Users.QueryRow("select count(*) from audit_logs where table_name='postings' and operation='update' and row_id=$1", seed.UserPostingID).Scan(&updates))
	require.NoError(t, app.d.Users.QueryRow("select count(*) from audit_logs where table_name='postings' and operation='insert' and before is null").Scan(&inserts))
	require.Positive(t, updates)
	require.Positive(t, inserts)
}

func TestDeleteImportedTransactionReturnsRowToInbox(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	food := createBucket(t, app, "expense", "Food")
	seed := seedCategorizedTransaction(t, app, time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC), bank, food, -1000, "EUR", "Market")

	resp := authed(t, app, http.MethodDelete, "/api/v1/transactions/"+seed.TransactionID, nil)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	var status string
	require.NoError(t, app.d.Users.QueryRow("select status from import_rows where id=$1", seed.RowID).Scan(&status))
	require.Equal(t, "pending", status)
	require.Len(t, getInbox(t, app, ""), 1)
}

func TestImportedFactsCannotChangeThroughWrites(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	food := createBucket(t, app, "expense", "Food")
	other := createBucket(t, app, "asset", "Other")
	seed := seedCategorizedTransaction(t, app, time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC), bank, food, -1000, "EUR", "Market")

	resp := authed(t, app, http.MethodPatch, "/api/v1/transactions/"+seed.TransactionID, map[string]any{"occurred_at": "2026-07-02T00:00:00Z"})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp = authed(t, app, http.MethodPatch, "/api/v1/postings/"+seed.ImportedID, map[string]any{"bucket_id": other})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	resp = authed(t, app, http.MethodPut, "/api/v1/transactions/"+seed.TransactionID+"/postings", map[string]any{"postings": []map[string]any{
		{"id": seed.ImportedID, "bucket_id": bank, "amount": -1000, "currency": "EUR"},
		{"id": seed.UserPostingID, "bucket_id": food, "amount": 1000, "currency": "EUR"},
	}})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)

	var amount, rowAmount int64
	var currency, bucketID, status string
	var occurredAt time.Time
	var links int
	require.NoError(t, app.d.Users.QueryRow(`select p.amount,p.currency,p.bucket_id,t.occurred_at,r.amount,r.status,
		(select count(*) from postings where import_row_id=r.id)
		from postings p join transactions t on t.id=p.transaction_id join import_rows r on r.id=p.import_row_id
		where p.id=$1`, seed.ImportedID).Scan(&amount, &currency, &bucketID, &occurredAt, &rowAmount, &status, &links))
	require.Equal(t, int64(-1000), amount)
	require.Equal(t, amount, rowAmount)
	require.Equal(t, "EUR", currency)
	require.Equal(t, bank, bucketID)
	require.True(t, occurredAt.Equal(time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)))
	require.Equal(t, "categorized", status)
	require.Equal(t, 1, links)
}

func TestTransactionOwnership(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	otherUserID := data.NewPrivateID()
	require.NoError(t, app.d.CreateUser(t.Context(), data.User{ID: otherUserID, Subject: "other-transactions", Issuer: "test", Email: "other@example.com", CreatedAt: time.Now()}))
	accountID, categoryID := data.NewPrivateID(), data.NewPrivateID()
	require.NoError(t, app.d.CreateBucket(t.Context(), data.Bucket{ID: accountID, OwnerUserID: otherUserID, Kind: data.KindAsset, Name: "Other bank", CreatedAt: time.Now()}))
	require.NoError(t, app.d.CreateBucket(t.Context(), data.Bucket{ID: categoryID, OwnerUserID: otherUserID, Kind: data.KindExpense, Name: "Other food", CreatedAt: time.Now()}))
	seed := seedCategorizedTransaction(t, app, time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC), accountID, categoryID, -1000, "EUR", "Private")

	resp := authed(t, app, http.MethodGet, "/api/v1/transactions/"+seed.TransactionID, nil)
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp = authed(t, app, http.MethodPatch, "/api/v1/postings/"+seed.UserPostingID, map[string]any{"bucket_id": categoryID})
	require.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp = authed(t, app, http.MethodPost, "/api/v1/transactions/tags", map[string]any{"posting_ids": []string{seed.UserPostingID}, "tag": "private"})
	require.Equal(t, http.StatusBadRequest, resp.StatusCode)
	var count int
	require.NoError(t, app.d.Users.QueryRow("select count(*) from posting_tags where posting_id=$1", seed.UserPostingID).Scan(&count))
	require.Zero(t, count)
}

func TestTransactionPagination(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	bank := createBucket(t, app, "asset", "Bank")
	food := createBucket(t, app, "expense", "Food")
	for i := 0; i < data.TransactionPageSize+1; i++ {
		seedCategorizedTransaction(t, app, time.Date(2026, 7, 1, 0, i, 0, 0, time.UTC), bank, food, -int64(i+1), "EUR", fmt.Sprintf("Row %d", i))
	}

	first := decodeTransactionPage(t, authed(t, app, http.MethodGet, "/api/v1/transactions", nil))
	require.Len(t, first.Transactions, data.TransactionPageSize)
	require.NotNil(t, first.NextCursor)
	query := url.Values{"before_date": {first.NextCursor.Date}, "before_id": {first.NextCursor.ID}}
	second := decodeTransactionPage(t, authed(t, app, http.MethodGet, "/api/v1/transactions?"+query.Encode(), nil))
	require.Len(t, second.Transactions, 1)
	require.NotEqual(t, first.Transactions[len(first.Transactions)-1].ID, second.Transactions[0].ID)
}

func TestTransactionEndpointsRequireAuth(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	for _, path := range []string{"/api/v1/transactions", "/api/v1/transactions/" + data.NewPrivateID()} {
		resp, err := app.client.Get(app.url + path)
		require.NoError(t, err)
		require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	}
}
