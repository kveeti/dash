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
	Account      string `json:"account"`
	Kind         string `json:"kind,omitempty"`
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
				Date:         formatDate(row.Date),
				Amount:       row.Amount,
				Currency:     row.Currency,
				Counterparty: row.Counterparty,
				Description:  row.Description,
				Account:      row.Account,
			}
		}
		if len(rows) == data.InboxPageSize {
			last := rows[len(rows)-1]
			out.NextCursor = &cursor{Date: formatDate(last.Date), ID: last.ID}
		}
		Json(w, out)
		return nil
	}
}

func inboxRowToResponse(row data.InboxRow) inboxRowResponse {
	return inboxRowResponse{ID: row.ID, Date: formatDate(row.Date), Amount: row.Amount, Currency: row.Currency, Counterparty: row.Counterparty, Description: row.Description, Account: row.Account}
}

func HandleGetInboxMatches(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		source, matches, err := state.Data.GetInboxMatches(r.Context(), userID, r.PathValue("id"), r.URL.Query().Get("q"))
		if err != nil {
			return mapTransactionErr(err)
		}
		out := struct {
			Source  inboxRowResponse   `json:"source"`
			Matches []inboxRowResponse `json:"matches"`
		}{Source: inboxRowToResponse(source), Matches: make([]inboxRowResponse, len(matches))}
		for i, row := range matches {
			out.Matches[i] = inboxRowToResponse(row.InboxRow)
			out.Matches[i].Kind = row.Kind
		}
		Json(w, out)
		return nil
	}
}

func HandleMatchInboxRows(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		var body struct {
			MatchID string `json:"match_id"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.MatchID == "" {
			return NewErr("invalid request body", http.StatusBadRequest)
		}
		if err := state.Data.MatchInboxRows(r.Context(), userID, r.PathValue("id"), body.MatchID); err != nil {
			return mapTransactionErr(err)
		}
		Json(w, map[string]bool{"matched": true})
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
