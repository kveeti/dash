package endpoints

import (
	"encoding/json"
	"errors"
	"money/backend/data"
	"money/backend/state"
	"net/http"
	"time"
)

const dateLayout = time.RFC3339

func formatDate(t time.Time) string { return t.UTC().Format(time.RFC3339) }

type postingBucketResponse struct {
	ID   string          `json:"id"`
	Name string          `json:"name"`
	Kind data.BucketKind `json:"kind"`
}
type postingResponse struct {
	ID        string                `json:"id"`
	Bucket    postingBucketResponse `json:"bucket"`
	Amount    int64                 `json:"amount"`
	Currency  string                `json:"currency"`
	StatsDate *string               `json:"stats_date"`
	Memo      string                `json:"memo"`
	Imported  bool                  `json:"imported"`
	Tags      []string              `json:"tags"`
}
type transferResponse struct {
	MatchID               string                 `json:"match_id,omitempty"`
	Side                  string                 `json:"side,omitempty"`
	CounterpartID         string                 `json:"counterpart_id,omitempty"`
	CounterpartOccurredAt string                 `json:"counterpart_occurred_at,omitempty"`
	CounterpartBucket     *postingBucketResponse `json:"counterpart_bucket,omitempty"`
	CounterpartAmount     int64                  `json:"counterpart_amount,omitempty"`
	CounterpartCurrency   string                 `json:"counterpart_currency,omitempty"`
	Unmatched             bool                   `json:"unmatched,omitempty"`
}
type transactionResponse struct {
	ID           string            `json:"id"`
	OccurredAt   string            `json:"occurred_at"`
	Counterparty string            `json:"counterparty"`
	Description  string            `json:"description"`
	Memo         string            `json:"memo"`
	Postings     []postingResponse `json:"postings"`
	Transfer     *transferResponse `json:"transfer,omitempty"`
}
type cursor struct {
	Date string `json:"date"`
	ID   string `json:"id"`
}
type transactionsResponse struct {
	Transactions []transactionResponse `json:"transactions"`
	NextCursor   *cursor               `json:"next_cursor"`
}

func parseCursor(r *http.Request) (time.Time, string, error) {
	id := r.URL.Query().Get("before_id")
	if id == "" {
		return time.Time{}, "", nil
	}
	date, err := time.Parse(dateLayout, r.URL.Query().Get("before_date"))
	if err != nil {
		return time.Time{}, "", NewErr("before_date must be an RFC3339 timestamp", http.StatusBadRequest)
	}
	return date, id, nil
}
func toPostingResponse(p data.Posting) postingResponse {
	var date *string
	if p.StatsDate != nil {
		x := p.StatsDate.Format("2006-01-02")
		date = &x
	}
	return postingResponse{ID: p.ID, Bucket: postingBucketResponse{p.Bucket.ID, p.Bucket.Name, p.Bucket.Kind}, Amount: p.Amount, Currency: p.Currency, StatsDate: date, Memo: p.Memo, Imported: p.ImportRowID != nil, Tags: p.Tags}
}
func toTransactionResponse(t data.Transaction, ps []data.Posting) transactionResponse {
	out := transactionResponse{ID: t.ID, OccurredAt: formatDate(t.OccurredAt), Counterparty: t.Counterparty, Description: t.Description, Memo: t.Memo, Postings: make([]postingResponse, len(ps))}
	for i, p := range ps {
		out.Postings[i] = toPostingResponse(p)
	}
	if t.Transfer != nil {
		out.Transfer = &transferResponse{
			MatchID:             t.Transfer.MatchID,
			Side:                t.Transfer.Side,
			CounterpartID:       t.Transfer.CounterpartID,
			CounterpartAmount:   t.Transfer.CounterpartAmount,
			CounterpartCurrency: t.Transfer.CounterpartCurrency,
			Unmatched:           t.Transfer.Unmatched,
		}
		if !t.Transfer.CounterpartOccurredAt.IsZero() {
			out.Transfer.CounterpartOccurredAt = formatDate(t.Transfer.CounterpartOccurredAt)
		}
		if t.Transfer.CounterpartBucket != nil {
			out.Transfer.CounterpartBucket = &postingBucketResponse{
				ID:   t.Transfer.CounterpartBucket.ID,
				Name: t.Transfer.CounterpartBucket.Name,
				Kind: t.Transfer.CounterpartBucket.Kind,
			}
		}
	}
	return out
}
func mapTransactionErr(err error) error {
	switch {
	case errors.Is(err, data.ErrNotFound):
		return NewErr(err.Error(), http.StatusNotFound)
	case errors.Is(err, data.ErrUnbalanced), errors.Is(err, data.ErrInvalidPostings), errors.Is(err, data.ErrInvalidBucket), errors.Is(err, data.ErrInvalidCategory), errors.Is(err, data.ErrInvalidCurrency), errors.Is(err, data.ErrInvalidTag), errors.Is(err, data.ErrPostingNotEditable), errors.Is(err, data.ErrTransferSplit):
		return NewErr(err.Error(), http.StatusBadRequest)
	default:
		return NewUnexpectedErr("transaction error: %w", err)
	}
}

func HandlePatchTransaction(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		var body struct {
			Memo *string `json:"memo"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&body) != nil || body.Memo == nil {
			return NewErr("invalid request body", http.StatusBadRequest)
		}
		if err = state.Data.PatchTransactionMemo(r.Context(), userID, r.PathValue("id"), *body.Memo); err != nil {
			return mapTransactionErr(err)
		}
		txn, ps, err := state.Data.GetTransaction(r.Context(), userID, r.PathValue("id"))
		if err != nil {
			return mapTransactionErr(err)
		}
		Json(w, toTransactionResponse(*txn, ps))
		return nil
	}
}
func HandlePatchPosting(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		var body struct {
			BucketID *string `json:"bucket_id"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&body) != nil || body.BucketID == nil {
			return NewErr("invalid request body", http.StatusBadRequest)
		}
		if err = state.Data.CategorizePosting(r.Context(), userID, r.PathValue("id"), *body.BucketID); err != nil {
			return mapTransactionErr(err)
		}
		Json(w, map[string]bool{"updated": true})
		return nil
	}
}
func HandleBulkCategorize(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		var body struct {
			TransactionIDs []string `json:"transaction_ids"`
			BucketID       string   `json:"bucket_id"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			return NewErr("invalid request body", http.StatusBadRequest)
		}
		n, err := state.Data.BulkCategorize(r.Context(), userID, body.TransactionIDs, body.BucketID)
		if err != nil {
			return mapTransactionErr(err)
		}
		Json(w, map[string]int{"categorized": n})
		return nil
	}
}
func HandleRemoveTransactions(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		var body struct {
			TransactionIDs []string `json:"transaction_ids"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			return NewErr("invalid request body", http.StatusBadRequest)
		}
		removed, restored, err := state.Data.RemoveTransactions(r.Context(), userID, body.TransactionIDs)
		if err != nil {
			return mapTransactionErr(err)
		}
		Json(w, map[string]int{"removed": removed, "restored": restored})
		return nil
	}
}
func HandleDeleteTransaction(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		if err = state.Data.DeleteTransaction(r.Context(), userID, r.PathValue("id")); err != nil {
			return mapTransactionErr(err)
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}
func HandleUnmatchTransfer(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		n, err := state.Data.UnmatchTransfer(r.Context(), userID, r.PathValue("id"))
		if err != nil {
			return mapTransactionErr(err)
		}
		Json(w, map[string]int{"restored": n})
		return nil
	}
}
func HandleGetTransaction(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		t, ps, err := state.Data.GetTransaction(r.Context(), userID, r.PathValue("id"))
		if err != nil {
			return mapTransactionErr(err)
		}
		Json(w, toTransactionResponse(*t, ps))
		return nil
	}
}
func HandleListTransactions(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		date, id, err := parseCursor(r)
		if err != nil {
			return err
		}
		timezone := r.URL.Query().Get("timezone")
		if timezone != "" {
			if _, err := time.LoadLocation(timezone); err != nil {
				return NewErr("invalid timezone", http.StatusBadRequest)
			}
		}
		txns, postings, err := state.Data.ListTransactions(r.Context(), userID, timezone, date, id, r.URL.Query().Get("q"), r.URL.Query().Get("tag"))
		if err != nil {
			return NewUnexpectedErr("error listing transactions: %w", err)
		}
		out := transactionsResponse{Transactions: make([]transactionResponse, len(txns))}
		for i, t := range txns {
			out.Transactions[i] = toTransactionResponse(t, postings[t.ID])
		}
		if len(txns) == data.TransactionPageSize {
			last := txns[len(txns)-1]
			out.NextCursor = &cursor{formatDate(last.OccurredAt), last.ID}
		}
		Json(w, out)
		return nil
	}
}

func HandleSplitTransaction(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		var body struct {
			Postings []struct {
				ID        string  `json:"id"`
				BucketID  string  `json:"bucket_id"`
				Amount    int64   `json:"amount"`
				Currency  string  `json:"currency"`
				StatsDate *string `json:"stats_date"`
				Memo      string  `json:"memo"`
			} `json:"postings"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			return NewErr("invalid request body", http.StatusBadRequest)
		}
		input := make([]data.SplitPosting, len(body.Postings))
		for i, p := range body.Postings {
			var date *time.Time
			if p.StatsDate != nil && *p.StatsDate != "" {
				x, e := time.Parse("2006-01-02", *p.StatsDate)
				if e != nil {
					return NewErr("stats_date must be YYYY-MM-DD", http.StatusBadRequest)
				}
				date = &x
			}
			input[i] = data.SplitPosting{ID: p.ID, BucketID: p.BucketID, Amount: p.Amount, Currency: p.Currency, StatsDate: date, Memo: p.Memo}
		}
		if err = state.Data.SplitTransaction(r.Context(), userID, r.PathValue("id"), input); err != nil {
			return mapTransactionErr(err)
		}
		txn, ps, err := state.Data.GetTransaction(r.Context(), userID, r.PathValue("id"))
		if err != nil {
			return mapTransactionErr(err)
		}
		Json(w, toTransactionResponse(*txn, ps))
		return nil
	}
}
