package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestSignJWT(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)

	token, err := signJWT("app-id", key, now)
	require.NoError(t, err)
	parts := strings.Split(token, ".")
	require.Len(t, parts, 3)

	decode := func(raw string, out any) {
		value, err := base64.RawURLEncoding.DecodeString(raw)
		require.NoError(t, err)
		require.NoError(t, json.Unmarshal(value, out))
	}
	var header map[string]any
	decode(parts[0], &header)
	require.Equal(t, "JWT", header["typ"])
	require.Equal(t, "RS256", header["alg"])
	require.Equal(t, "app-id", header["kid"])

	var claims map[string]any
	decode(parts[1], &claims)
	require.Equal(t, "enablebanking.com", claims["iss"])
	require.Equal(t, "api.enablebanking.com", claims["aud"])
	require.Equal(t, float64(now.Unix()), claims["iat"])
	require.Equal(t, float64(now.Unix()+300), claims["exp"])

	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	require.NoError(t, err)
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	require.NoError(t, rsa.VerifyPKCS1v15(&key.PublicKey, crypto.SHA256, digest[:], signature))
}

func TestParseRSAPrivateKey(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	pkcs1 := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	got, err := parseRSAPrivateKey(pkcs1)
	require.NoError(t, err)
	require.Equal(t, key.N, got.N)

	pkcs8Bytes, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err)
	pkcs8 := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8Bytes})
	got, err = parseRSAPrivateKey(pkcs8)
	require.NoError(t, err)
	require.Equal(t, key.N, got.N)

	_, err = parseRSAPrivateKey([]byte("not a key"))
	require.EqualError(t, err, "private key is not PEM encoded")
}

func TestAuthorizationCode(t *testing.T) {
	code, err := authorizationCode("https://example.test/callback?code=code-1&state=state-1", "state-1")
	require.NoError(t, err)
	require.Equal(t, "code-1", code)

	_, err = authorizationCode("https://example.test/callback?code=code-1&state=wrong", "state-1")
	require.EqualError(t, err, "redirected URL has the wrong state")

	_, err = authorizationCode("https://example.test/callback?error=access_denied&error_description=Cancelled&state=state-1", "state-1")
	require.EqualError(t, err, "authorization failed: access_denied: Cancelled")
}

func TestSelectASPSP(t *testing.T) {
	raw := json.RawMessage(`{"aspsps":[{"name":"OP","country":"FI","maximum_consent_validity":100},{"name":"Revolut","country":"FI","maximum_consent_validity":200}]}`)
	selected, validity, err := selectASPSP(raw, "Revolut", "FI")
	require.NoError(t, err)
	require.Equal(t, int64(200), validity)
	require.JSONEq(t, `{"name":"Revolut","country":"FI","maximum_consent_validity":200}`, string(selected))

	_, _, err = selectASPSP(raw, "Nordea", "FI")
	require.ErrorContains(t, err, "was not returned")
}

func TestAPIRequest(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.True(t, strings.HasPrefix(r.Header.Get("Authorization"), "Bearer "))
		require.NotEmpty(t, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		require.Equal(t, "value", r.URL.Query().Get("key"))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	client := &apiClient{
		origin: server.URL,
		appID:  "app-id",
		key:    key,
		http:   server.Client(),
		now:    func() time.Time { return time.Unix(100, 0) },
	}
	response, err := client.request(http.MethodGet, "/test", url.Values{"key": {"value"}}, nil)
	require.NoError(t, err)
	require.Equal(t, http.StatusCreated, response.Status)
	require.JSONEq(t, `{"ok":true}`, string(response.Body))
}
