package endpoints

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"money/backend/auth"
	"money/backend/data"

	"github.com/stretchr/testify/require"
)

// login runs the full OIDC flow and returns the auth cookie.
func login(t *testing.T, app *testApp) *http.Cookie {
	t.Helper()
	resp := completeLogin(t, app)
	cookie := findCookie(resp.Cookies(), auth.CookieName)
	require.NotNil(t, cookie)
	return cookie
}

func authed(t *testing.T, app *testApp, method, path string, body any) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&buf).Encode(body))
	}
	req, err := http.NewRequest(method, app.url+path, &buf)
	require.NoError(t, err)
	req.AddCookie(login(t, app))
	resp, err := app.client.Do(req)
	require.NoError(t, err)
	return resp
}

func decodeBuckets(t *testing.T, resp *http.Response) []map[string]any {
	t.Helper()
	var out []map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out
}

func TestNewUserSystemBucketsAreHidden(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})

	resp := authed(t, app, http.MethodGet, "/api/v1/buckets", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Empty(t, decodeBuckets(t, resp))

	var transit, fx int
	require.NoError(t, app.d.Users.QueryRow("select count(*) filter(where kind='transit'),count(*) filter(where kind='fx_conversion') from buckets where hidden=true").Scan(&transit, &fx))
	require.Equal(t, 1, transit)
	require.Equal(t, 1, fx)

	var userAudits, bucketAudits int
	require.NoError(t, app.d.Users.QueryRow(`
		select
			count(*) filter (where table_name = 'users'),
			count(*) filter (where table_name = 'buckets')
		from audit_logs
		where operation = 'insert'
		  and before is null
	`).Scan(&userAudits, &bucketAudits))
	require.Equal(t, 1, userAudits)
	require.Equal(t, 2, bucketAudits)
}

func TestCreateUserRollsBackSystemBuckets(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	login(t, app)
	var issuer, subject string
	require.NoError(t, app.d.Users.QueryRow("select issuer, subject from users limit 1").Scan(&issuer, &subject))

	userID := data.NewPrivateID()
	err := app.d.CreateUser(t.Context(), data.User{
		ID: userID, Subject: subject, Issuer: issuer, Email: "duplicate@example.com", CreatedAt: time.Now(),
	})
	require.Error(t, err)

	var users, buckets, audits int
	require.NoError(t, app.d.Users.QueryRow(`
		select
			(select count(*) from users where id = $1),
			(select count(*) from buckets where owner_user_id = $1),
			(select count(*) from audit_logs where actor_user_id = $1)
	`, userID).Scan(&users, &buckets, &audits))
	require.Zero(t, users)
	require.Zero(t, buckets)
	require.Zero(t, audits)
}

func TestCreateAndListBucket(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})

	resp := authed(t, app, http.MethodPost, "/api/v1/buckets",
		map[string]any{"kind": "expense", "name": "Groceries"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	var created map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
	require.Equal(t, "Groceries", created["name"])
	require.NotEmpty(t, created["id"])

	resp = authed(t, app, http.MethodGet, "/api/v1/buckets", nil)
	buckets := decodeBuckets(t, resp)
	require.Len(t, buckets, 1)

	var names []string
	for _, b := range buckets {
		names = append(names, b["name"].(string))
	}
	require.Contains(t, names, "Groceries")
}

func TestSearchBuckets(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})

	for i := 0; i < 55; i++ {
		resp := authed(t, app, http.MethodPost, "/api/v1/buckets", map[string]any{
			"kind": "expense",
			"name": fmt.Sprintf("Search %02d", i),
		})
		require.Equal(t, http.StatusCreated, resp.StatusCode)
		resp.Body.Close()
	}
	resp := authed(t, app, http.MethodPost, "/api/v1/buckets", map[string]any{
		"kind": "expense",
		"name": "Search",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	resp = authed(t, app, http.MethodGet, "/api/v1/buckets?q=SEARCH", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	buckets := decodeBuckets(t, resp)
	require.Len(t, buckets, 50)
	require.Equal(t, "Search", buckets[0]["name"])
	for _, bucket := range buckets {
		require.NotEqual(t, "clearing", bucket["kind"])
	}

	resp = authed(t, app, http.MethodGet, "/api/v1/buckets?q=SEARCH&kind=person", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Empty(t, decodeBuckets(t, resp))

	resp = authed(t, app, http.MethodGet, "/api/v1/buckets?q=", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	for _, bucket := range decodeBuckets(t, resp) {
		require.NotEqual(t, "clearing", bucket["kind"])
	}
}

func TestCreateBucketWithParent(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	parentID := createBucket(t, app, "expense", "Food")

	resp := authed(t, app, http.MethodPost, "/api/v1/buckets", map[string]any{
		"kind": "expense", "name": "Groceries", "parent_id": parentID,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var child map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&child))
	require.Equal(t, parentID, child["parent_id"])
}

func TestCreateBucketRejectsInvalidParent(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	expenseID := createBucket(t, app, "expense", "Food")
	incomeID := createBucket(t, app, "income", "Salary")
	assetID := createBucket(t, app, "asset", "Bank")

	childResponse := authed(t, app, http.MethodPost, "/api/v1/buckets", map[string]any{
		"kind": "expense", "name": "Groceries", "parent_id": expenseID,
	})
	require.Equal(t, http.StatusCreated, childResponse.StatusCode)
	var child map[string]any
	require.NoError(t, json.NewDecoder(childResponse.Body).Decode(&child))
	childID := child["id"].(string)

	otherUserID := data.NewPrivateID()
	require.NoError(t, app.d.CreateUser(t.Context(), data.User{
		ID: otherUserID, Subject: "other-bucket-parent", Issuer: "test",
		Email: "other@example.com", CreatedAt: time.Now(),
	}))
	otherParentID := data.NewPrivateID()
	require.NoError(t, app.d.CreateBucket(t.Context(), data.Bucket{
		ID: otherParentID, OwnerUserID: otherUserID, Kind: data.KindExpense,
		Name: "Private", CreatedAt: time.Now(),
	}))

	hiddenParentID := data.NewPrivateID()
	var userID string
	require.NoError(t, app.d.Users.QueryRow("select owner_user_id from buckets where id=$1", expenseID).Scan(&userID))
	require.NoError(t, app.d.CreateBucket(t.Context(), data.Bucket{
		ID: hiddenParentID, OwnerUserID: userID, Kind: data.KindExpense,
		Name: "Hidden", Hidden: true, CreatedAt: time.Now(),
	}))

	for name, body := range map[string]map[string]any{
		"malformed":       {"kind": "expense", "name": "Bad", "parent_id": "bad"},
		"missing":         {"kind": "expense", "name": "Bad", "parent_id": data.NewPrivateID()},
		"wrong kind":      {"kind": "expense", "name": "Bad", "parent_id": incomeID},
		"non-category":    {"kind": "asset", "name": "Bad", "parent_id": assetID},
		"nested":          {"kind": "expense", "name": "Bad", "parent_id": childID},
		"another user":    {"kind": "expense", "name": "Bad", "parent_id": otherParentID},
		"hidden category": {"kind": "expense", "name": "Bad", "parent_id": hiddenParentID},
	} {
		t.Run(name, func(t *testing.T) {
			resp := authed(t, app, http.MethodPost, "/api/v1/buckets", body)
			require.Equal(t, http.StatusBadRequest, resp.StatusCode)
		})
	}
}

func TestCreatePersonBucket(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})

	resp := authed(t, app, http.MethodPost, "/api/v1/buckets",
		map[string]any{"kind": "person", "name": "Bob"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)

	var created map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))
	require.Equal(t, "person", created["kind"])
	require.Equal(t, "Bob", created["name"])
}

func TestCreateBucketRejectsBadKind(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})

	for _, kind := range []string{"clearing", "nonsense"} {
		resp := authed(t, app, http.MethodPost, "/api/v1/buckets",
			map[string]any{"kind": kind, "name": "x"})
		require.Equal(t, http.StatusBadRequest, resp.StatusCode, kind)
	}
}

func TestCreateBucketRequiresAuth(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})

	resp, err := app.client.Post(app.url+"/api/v1/buckets", "application/json",
		bytes.NewBufferString(`{"kind":"expense","name":"x"}`))
	require.NoError(t, err)
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}
