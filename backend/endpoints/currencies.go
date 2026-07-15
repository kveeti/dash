package endpoints

import (
	"money/backend/state"
	"net/http"
)

type currencyResponse struct {
	Code     string `json:"code"`
	Exponent int    `json:"exponent"`
}

func HandleListCurrencies(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		if _, err := getUserID(r); err != nil {
			return err
		}
		currencies, err := state.Data.ListCurrencies(r.Context())
		if err != nil {
			return NewUnexpectedErr("error listing currencies: %w", err)
		}
		out := make([]currencyResponse, len(currencies))
		for i, currency := range currencies {
			out[i] = currencyResponse{Code: currency.Code, Exponent: currency.Exponent}
		}
		Json(w, out)
		return nil
	}
}
