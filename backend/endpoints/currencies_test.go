package endpoints

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestListCurrencies(t *testing.T) {
	app := newTestAppWith(t, appOpts{frontURL: testFrontURL})
	resp := authed(t, app, http.MethodGet, "/api/v1/currencies", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var currencies []struct {
		Code     string `json:"code"`
		Exponent int    `json:"exponent"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&currencies))
	exponents := map[string]int{}
	for _, currency := range currencies {
		exponents[currency.Code] = currency.Exponent
	}
	require.Equal(t, 2, exponents["EUR"])
	require.Equal(t, 0, exponents["JPY"])
}
