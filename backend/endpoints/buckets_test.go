package endpoints

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"

	"money/backend/auth"

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

// A new user starts with exactly the two hidden buckets (clearing + uncategorized).
func TestNewUserHasHiddenBuckets(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})

	resp := authed(t, app, http.MethodGet, "/api/v1/buckets", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	buckets := decodeBuckets(t, resp)
	require.Len(t, buckets, 2)

	kinds := map[string]bool{}
	for _, b := range buckets {
		require.True(t, b["hidden"].(bool))
		kinds[b["kind"].(string)] = true
	}
	require.True(t, kinds["clearing"])
	require.True(t, kinds["expense"])
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
	require.Len(t, buckets, 3) // 2 hidden + Groceries

	var names []string
	for _, b := range buckets {
		names = append(names, b["name"].(string))
	}
	require.Contains(t, names, "Groceries")
}

func TestCreateBucketRejectsBadKind(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})

	for _, kind := range []string{"clearing", "person", "nonsense"} {
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
