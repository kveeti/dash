package endpoints

import (
	"encoding/json"
	"errors"
	"money/backend/data"
	"money/backend/state"
	"net/http"
	"time"
)

const dateLayout = "2006-01-02"

type postingBody struct {
	BucketID string `json:"bucket_id"`
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

type postingResponse struct {
	ID       string `json:"id"`
	BucketID string `json:"bucket_id"`
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

type transactionResponse struct {
	ID           string            `json:"id"`
	Date         string            `json:"date"`
	Counterparty string            `json:"counterparty"`
	Description  string            `json:"description"`
	Postings     []postingResponse `json:"postings"`
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
		return time.Time{}, "", NewErr("before_date must be YYYY-MM-DD", http.StatusBadRequest)
	}
	return date, id, nil
}

func toPostingResponse(p data.Posting) postingResponse {
	return postingResponse{ID: p.ID, BucketID: p.BucketID, Amount: p.Amount, Currency: p.Currency}
}

func decodeTransactionBody(r *http.Request) (time.Time, string, string, []data.Posting, error) {
	var body struct {
		Date         string        `json:"date"`
		Counterparty string        `json:"counterparty"`
		Description  string        `json:"description"`
		Postings     []postingBody `json:"postings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return time.Time{}, "", "", nil, NewErr("invalid request body", http.StatusBadRequest)
	}
	date, err := time.Parse(dateLayout, body.Date)
	if err != nil {
		return time.Time{}, "", "", nil, NewErr("date must be YYYY-MM-DD", http.StatusBadRequest)
	}
	postings := make([]data.Posting, len(body.Postings))
	for i, p := range body.Postings {
		postings[i] = data.Posting{BucketID: p.BucketID, Amount: p.Amount, Currency: p.Currency}
	}
	return date, body.Counterparty, body.Description, postings, nil
}

func mapTransactionErr(err error) error {
	switch {
	case errors.Is(err, data.ErrNotFound):
		return NewErr(err.Error(), http.StatusNotFound)
	case errors.Is(err, data.ErrUnbalanced), errors.Is(err, data.ErrInvalidPostings), errors.Is(err, data.ErrInvalidBucket), errors.Is(err, data.ErrInvalidCategory):
		return NewErr(err.Error(), http.StatusBadRequest)
	default:
		return NewUnexpectedErr("transaction error: %w", err)
	}
}

func writeTransaction(w http.ResponseWriter, status int, txn *data.Transaction, postings []data.Posting) {
	out := transactionResponse{
		ID:           txn.ID,
		Date:         txn.Date.Format(dateLayout),
		Counterparty: txn.Counterparty,
		Description:  txn.Description,
		Postings:     make([]postingResponse, len(postings)),
	}
	for i, p := range postings {
		out.Postings[i] = toPostingResponse(p)
	}
	JsonStatus(w, status, out)
}

func HandleCreateTransaction(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		date, counterparty, description, postings, err := decodeTransactionBody(r)
		if err != nil {
			return err
		}

		txn := data.Transaction{ID: data.NewPrivateID(), OwnerUserID: userID, Date: date, Counterparty: counterparty, Description: description}
		created, createdPostings, err := state.Data.CreateTransaction(r.Context(), txn, postings)
		if err != nil {
			return mapTransactionErr(err)
		}

		writeTransaction(w, http.StatusCreated, created, createdPostings)
		return nil
	}
}

func HandleUpdateTransaction(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		date, counterparty, description, postings, err := decodeTransactionBody(r)
		if err != nil {
			return err
		}

		updated, updatedPostings, err := state.Data.UpdateTransaction(r.Context(), userID, r.PathValue("id"), date, counterparty, description, postings)
		if err != nil {
			return mapTransactionErr(err)
		}

		writeTransaction(w, http.StatusOK, updated, updatedPostings)
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
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
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

func HandleDeleteTransaction(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		if err := state.Data.DeleteTransaction(r.Context(), userID, r.PathValue("id")); err != nil {
			return mapTransactionErr(err)
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func HandleListTransactions(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}

		cursorDate, cursorID, err := parseCursor(r)
		if err != nil {
			return err
		}

		q := r.URL.Query().Get("q")

		txns, postings, err := state.Data.ListTransactions(r.Context(), userID, cursorDate, cursorID, q)
		if err != nil {
			return NewUnexpectedErr("error listing transactions: %w", err)
		}

		out := transactionsResponse{Transactions: make([]transactionResponse, len(txns))}
		for i, t := range txns {
			ps := make([]postingResponse, len(postings[t.ID]))
			for j, p := range postings[t.ID] {
				ps[j] = toPostingResponse(p)
			}
			out.Transactions[i] = transactionResponse{ID: t.ID, Date: t.Date.Format(dateLayout), Counterparty: t.Counterparty, Description: t.Description, Postings: ps}
		}
		if len(txns) == data.TransactionPageSize {
			last := txns[len(txns)-1]
			out.NextCursor = &cursor{Date: last.Date.Format(dateLayout), ID: last.ID}
		}
		Json(w, out)
		return nil
	}
}
