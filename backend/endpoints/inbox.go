package endpoints

import (
	"encoding/json"
	"money/backend/data"
	"money/backend/state"
	"net/http"
	"time"
)

type inboxRowResponse struct {
	ID           string  `json:"id"`
	Date         string  `json:"date"`
	OccurredAt   *string `json:"occurred_at"`
	Amount       int64   `json:"amount"`
	Currency     string  `json:"currency"`
	Counterparty string  `json:"counterparty"`
	Description  string  `json:"description"`
	Account      string  `json:"account"`
	Kind         string  `json:"kind,omitempty"`
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
		cursorDate, cursorID, err := parseDayCursor(r)
		if err != nil {
			return err
		}
		filter, err := parseInboxFilter(r, state)
		if err != nil {
			return err
		}

		rows, err := state.Data.ListInbox(r.Context(), userID, cursorDate, cursorID, filter)
		if err != nil {
			return NewUnexpectedErr("error listing inbox: %w", err)
		}

		out := inboxResponse{Rows: make([]inboxRowResponse, len(rows))}
		for i, row := range rows {
			out.Rows[i] = inboxRowToResponse(row)
		}
		if len(rows) == data.InboxPageSize {
			last := rows[len(rows)-1]
			out.NextCursor = &cursor{Date: formatDay(last.Date), ID: last.ID}
		}
		Json(w, out)
		return nil
	}
}

func parseInboxFilter(r *http.Request, state *state.State) (data.TransactionFilter, error) {
	if r.URL.Query().Has("category") || r.URL.Query().Has("tag") {
		return data.TransactionFilter{}, NewErr("unsupported inbox filter", http.StatusBadRequest)
	}
	filter, err := parseTransactionFilter(r, state)
	if err != nil {
		return data.TransactionFilter{}, err
	}
	filter.Search = r.URL.Query().Get("q")
	return filter, nil
}

func inboxRowToResponse(row data.InboxRow) inboxRowResponse {
	out := inboxRowResponse{ID: row.ID, Date: formatDay(row.Date), Amount: row.Amount, Currency: row.Currency, Counterparty: row.Counterparty, Description: row.Description, Account: row.Account}
	if row.OccurredAt != nil {
		value := formatDate(*row.OccurredAt)
		out.OccurredAt = &value
	}
	return out
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

func HandleRestoreInbox(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		var body struct {
			RowIDs []string `json:"row_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return NewErr("invalid request body", http.StatusBadRequest)
		}
		restored, err := state.Data.RestoreInboxRows(r.Context(), userID, body.RowIDs)
		if err != nil {
			return mapTransactionErr(err)
		}
		Json(w, map[string]int{"restored": restored})
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
			Bucket   *struct {
				Kind data.BucketKind `json:"kind"`
				Name string          `json:"name"`
			} `json:"bucket"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return NewErr("invalid request body", http.StatusBadRequest)
		}
		if (body.BucketID == "") == (body.Bucket == nil) {
			return NewErr("provide either bucket_id or bucket", http.StatusBadRequest)
		}

		var bucket *data.Bucket
		var categorized int
		if body.Bucket != nil {
			validKind := body.Bucket.Kind == data.KindExpense || body.Bucket.Kind == data.KindIncome || body.Bucket.Kind == data.KindPerson
			if !validKind {
				return NewErr("invalid bucket kind", http.StatusBadRequest)
			}
			if body.Bucket.Name == "" {
				return NewErr("name is required", http.StatusBadRequest)
			}

			created := data.Bucket{
				ID:          data.NewPrivateID(),
				OwnerUserID: userID,
				Kind:        body.Bucket.Kind,
				Name:        body.Bucket.Name,
				CreatedAt:   time.Now(),
			}
			var err error
			categorized, err = state.Data.CreateBucketAndCategorizeInboxRows(r.Context(), userID, body.RowIDs, created)
			if err != nil {
				return mapTransactionErr(err)
			}
			if categorized > 0 {
				bucket = &created
			}
		} else {
			var err error
			categorized, err = state.Data.CategorizeInboxRows(r.Context(), userID, body.RowIDs, body.BucketID)
			if err != nil {
				return mapTransactionErr(err)
			}
		}

		out := struct {
			Categorized int             `json:"categorized"`
			Bucket      *bucketResponse `json:"bucket,omitempty"`
		}{Categorized: categorized}
		if bucket != nil {
			response := toBucketResponse(*bucket)
			out.Bucket = &response
		}
		Json(w, out)
		return nil
	}
}
