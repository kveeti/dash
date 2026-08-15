package endpoints

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNewHandlerLimitsJSONBody(t *testing.T) {
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/test",
		strings.NewReader(`"`+strings.Repeat("x", maxJSONBodyBytes)+`"`),
	)
	response := httptest.NewRecorder()
	var decodeErr error

	handler := NewHandler(func(_ http.ResponseWriter, r *http.Request) error {
		var body string
		decodeErr = json.NewDecoder(r.Body).Decode(&body)
		if decodeErr != nil {
			return NewErr("invalid request body", http.StatusBadRequest)
		}
		return nil
	})
	handler.ServeHTTP(response, request)

	var tooLarge *http.MaxBytesError
	require.True(t, errors.As(decodeErr, &tooLarge))
	require.Equal(t, http.StatusBadRequest, response.Code)
}

func TestNewHandlerLeavesImportBodyLimitToImportHandler(t *testing.T) {
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/imports",
		strings.NewReader(`"`+strings.Repeat("x", maxJSONBodyBytes)+`"`),
	)
	response := httptest.NewRecorder()

	handler := NewHandler(func(_ http.ResponseWriter, r *http.Request) error {
		var body string
		return json.NewDecoder(r.Body).Decode(&body)
	})
	handler.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
}
