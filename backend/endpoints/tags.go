package endpoints

import (
	"encoding/json"
	"money/backend/state"
	"net/http"
)

type tagBody struct {
	TransactionIDs []string `json:"transaction_ids"`
	Tag            string   `json:"tag"`
}

func HandleAddTransactionTag(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		var body tagBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return NewErr("invalid request body", http.StatusBadRequest)
		}
		count, err := state.Data.AddTransactionTag(r.Context(), userID, body.TransactionIDs, body.Tag)
		if err != nil {
			return mapTransactionErr(err)
		}
		Json(w, map[string]int{"tagged": count})
		return nil
	}
}

func HandleRemoveTransactionTag(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		var body tagBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return NewErr("invalid request body", http.StatusBadRequest)
		}
		count, err := state.Data.RemoveTransactionTag(r.Context(), userID, body.TransactionIDs, body.Tag)
		if err != nil {
			return mapTransactionErr(err)
		}
		Json(w, map[string]int{"untagged": count})
		return nil
	}
}

func HandleListTags(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		tags, err := state.Data.ListTags(r.Context(), userID, r.URL.Query().Get("q"))
		if err != nil {
			return NewUnexpectedErr("error listing tags: %w", err)
		}
		Json(w, map[string][]string{"tags": tags})
		return nil
	}
}
