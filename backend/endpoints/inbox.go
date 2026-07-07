package endpoints

import (
	"encoding/json"
	"money/backend/data"
	"money/backend/state"
	"net/http"
)

type inboxRowResponse struct {
	ID           string `json:"id"`
	Date         string `json:"date"`
	Amount       int64  `json:"amount"`
	Currency     string `json:"currency"`
	Counterparty string `json:"counterparty"`
	Description  string `json:"description"`
}

type inboxResponse struct {
	Rows       []inboxRowResponse `json:"rows"`
	NextCursor *cursor            `json:"next_cursor"`
}

func HandleListInbox(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		cursorDate, cursorID, err := parseCursor(r)
		if err != nil {
			return err
		}

		rows, err := state.Data.ListInbox(r.Context(), userID, cursorDate, cursorID, r.URL.Query().Get("q"))
		if err != nil {
			return NewUnexpectedErr("error listing inbox: %w", err)
		}

		out := inboxResponse{Rows: make([]inboxRowResponse, len(rows))}
		for i, row := range rows {
			out.Rows[i] = inboxRowResponse{
				ID:           row.ID,
				Date:         row.Date.Format(dateLayout),
				Amount:       row.Amount,
				Currency:     row.Currency,
				Counterparty: row.Counterparty,
				Description:  row.Description,
			}
		}
		if len(rows) == data.InboxPageSize {
			last := rows[len(rows)-1]
			out.NextCursor = &cursor{Date: last.Date.Format(dateLayout), ID: last.ID}
		}
		Json(w, out)
		return nil
	}
}

func HandleCategorizeInbox(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		var body struct {
			RowIDs   []string `json:"row_ids"`
			BucketID string   `json:"bucket_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return NewErr("invalid request body", http.StatusBadRequest)
		}

		n, err := state.Data.CategorizeInboxRows(r.Context(), userID, body.RowIDs, body.BucketID)
		if err != nil {
			return mapTransactionErr(err)
		}
		Json(w, map[string]int{"categorized": n})
		return nil
	}
}
