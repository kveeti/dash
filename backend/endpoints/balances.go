package endpoints

import (
	"money/backend/state"
	"net/http"
)

type balanceResponse struct {
	BucketID string `json:"bucket_id"`
	Currency string `json:"currency"`
	Amount   int64  `json:"amount"`
}

func HandleGetBalances(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}

		balances, err := state.Data.GetBalances(r.Context(), userID)
		if err != nil {
			return NewUnexpectedErr("error getting balances: %w", err)
		}

		out := make([]balanceResponse, len(balances))
		for i, b := range balances {
			out[i] = balanceResponse{BucketID: b.BucketID, Currency: b.Currency, Amount: b.Amount}
		}
		Json(w, out)
		return nil
	}
}
