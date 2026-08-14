package endpoints

import (
	"encoding/json"
	"errors"
	"math"
	"money/backend/data"
	"money/backend/state"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

const dateLayout = time.RFC3339

func formatDate(t time.Time) string      { return t.UTC().Format(time.RFC3339) }
func formatTimestamp(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
func formatDay(t time.Time) string       { return t.Format(time.DateOnly) }

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
	CounterpartOccurredOn string                 `json:"counterpart_occurred_on,omitempty"`
	CounterpartOccurredAt *string                `json:"counterpart_occurred_at,omitempty"`
	CounterpartBucket     *postingBucketResponse `json:"counterpart_bucket,omitempty"`
	CounterpartAmount     int64                  `json:"counterpart_amount,omitempty"`
	CounterpartCurrency   string                 `json:"counterpart_currency,omitempty"`
	Unmatched             bool                   `json:"unmatched,omitempty"`
}
type transactionResponse struct {
	ID                     string            `json:"id"`
	OccurredOn             string            `json:"occurred_on"`
	OccurredAt             *string           `json:"occurred_at"`
	Counterparty           string            `json:"counterparty"`
	Description            string            `json:"description"`
	Memo                   string            `json:"memo"`
	Postings               []postingResponse `json:"postings"`
	LatestPostingTimestamp string            `json:"latest_posting_timestamp"`
	Transfer               *transferResponse `json:"transfer,omitempty"`
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

func parseDayCursor(r *http.Request) (time.Time, string, error) {
	id := r.URL.Query().Get("before_id")
	if id == "" {
		return time.Time{}, "", nil
	}
	date, err := time.Parse(time.DateOnly, r.URL.Query().Get("before_date"))
	if err != nil {
		return time.Time{}, "", NewErr("before_date must use YYYY-MM-DD", http.StatusBadRequest)
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
	out := transactionResponse{ID: t.ID, OccurredOn: formatDay(t.OccurredOn), Counterparty: t.Counterparty, Description: t.Description, Memo: t.Memo, Postings: make([]postingResponse, len(ps))}
	if t.OccurredAt != nil {
		value := formatDate(*t.OccurredAt)
		out.OccurredAt = &value
	}
	var latestPostingTimestamp time.Time
	for i, p := range ps {
		out.Postings[i] = toPostingResponse(p)
		postingTimestamp := p.UpdatedAt
		if p.CreatedAt.After(postingTimestamp) {
			postingTimestamp = p.CreatedAt
		}
		if postingTimestamp.After(latestPostingTimestamp) {
			latestPostingTimestamp = postingTimestamp
		}
	}
	if !latestPostingTimestamp.IsZero() {
		out.LatestPostingTimestamp = formatTimestamp(latestPostingTimestamp)
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
		if !t.Transfer.CounterpartOccurredOn.IsZero() {
			out.Transfer.CounterpartOccurredOn = formatDay(t.Transfer.CounterpartOccurredOn)
		}
		if t.Transfer.CounterpartOccurredAt != nil {
			value := formatDate(*t.Transfer.CounterpartOccurredAt)
			out.Transfer.CounterpartOccurredAt = &value
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
	case errors.Is(err, data.ErrPostingConflict):
		return NewErr(err.Error(), http.StatusConflict)
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
		date, id, err := parseDayCursor(r)
		if err != nil {
			return err
		}
		timezone := r.URL.Query().Get("timezone")
		if timezone != "" {
			if _, err := time.LoadLocation(timezone); err != nil {
				return NewErr("invalid timezone", http.StatusBadRequest)
			}
		}
		filter, err := parseTransactionFilter(r, state)
		if err != nil {
			return err
		}
		filter.Search = r.URL.Query().Get("q")
		txns, postings, err := state.Data.ListTransactions(r.Context(), userID, timezone, date, id, filter)
		if err != nil {
			return NewUnexpectedErr("error listing transactions: %w", err)
		}
		out := transactionsResponse{Transactions: make([]transactionResponse, len(txns))}
		for i, t := range txns {
			out.Transactions[i] = toTransactionResponse(t, postings[t.ID])
		}
		if len(txns) == data.TransactionPageSize {
			last := txns[len(txns)-1]
			out.NextCursor = &cursor{formatDay(last.OccurredOn), last.ID}
		}
		Json(w, out)
		return nil
	}
}

func parseTransactionFilter(r *http.Request, state *state.State) (data.TransactionFilter, error) {
	query := r.URL.Query()
	filter := data.TransactionFilter{
		Categories: query["category"],
		Tags:       query["tag"],
		Accounts:   query["account"],
	}
	for _, id := range append(append([]string{}, filter.Categories...), filter.Accounts...) {
		if _, err := uuid.Parse(id); err != nil {
			return data.TransactionFilter{}, NewErr("invalid bucket id", http.StatusBadRequest)
		}
	}
	for _, tag := range filter.Tags {
		if strings.TrimSpace(tag) == "" {
			return data.TransactionFilter{}, NewErr("invalid tag", http.StatusBadRequest)
		}
	}

	if direction := query.Get("direction"); direction != "" {
		if direction != "in" && direction != "out" {
			return data.TransactionFilter{}, NewErr("direction must be in or out", http.StatusBadRequest)
		}
		filter.Direction = direction
	}
	for _, field := range []struct {
		name string
		to   **time.Time
	}{{"occurred_from", &filter.OccurredFrom}, {"occurred_before", &filter.OccurredBefore}} {
		if value := query.Get(field.name); value != "" {
			parsed, err := time.Parse(time.DateOnly, value)
			if err != nil {
				if instant, instantErr := time.Parse(time.RFC3339, value); instantErr == nil {
					parsed = time.Date(instant.Year(), instant.Month(), instant.Day(), 0, 0, 0, 0, time.UTC)
				} else {
					return data.TransactionFilter{}, NewErr(field.name+" must use YYYY-MM-DD", http.StatusBadRequest)
				}
			}
			*field.to = &parsed
		}
	}
	if filter.OccurredFrom != nil && filter.OccurredBefore != nil && !filter.OccurredFrom.Before(*filter.OccurredBefore) {
		return data.TransactionFilter{}, NewErr("occurred_from must be before occurred_before", http.StatusBadRequest)
	}

	amount, minimum, maximum := query.Get("amount"), query.Get("amount_min"), query.Get("amount_max")
	if amount != "" && (minimum != "" || maximum != "") {
		return data.TransactionFilter{}, NewErr("amount cannot be combined with amount_min or amount_max", http.StatusBadRequest)
	}
	if amount != "" || minimum != "" || maximum != "" {
		currency := query.Get("currency")
		exponents, err := state.Data.ListCurrencies(r.Context())
		if err != nil {
			return data.TransactionFilter{}, NewUnexpectedErr("error listing currencies: %w", err)
		}
		exponent := -1
		for _, item := range exponents {
			if item.Code == currency {
				exponent = item.Exponent
				break
			}
		}
		if exponent < 0 {
			return data.TransactionFilter{}, NewErr("invalid amount currency", http.StatusBadRequest)
		}
		filter.Currency = currency
		for _, field := range []struct {
			value string
			to    **int64
		}{{amount, &filter.Amount}, {minimum, &filter.AmountMin}, {maximum, &filter.AmountMax}} {
			if field.value == "" {
				continue
			}
			parsed, ok := parseAmountMinor(field.value, exponent)
			if !ok {
				return data.TransactionFilter{}, NewErr("invalid amount", http.StatusBadRequest)
			}
			*field.to = &parsed
		}
		if filter.AmountMin != nil && filter.AmountMax != nil && *filter.AmountMin > *filter.AmountMax {
			return data.TransactionFilter{}, NewErr("amount_min must not exceed amount_max", http.StatusBadRequest)
		}
	}
	return filter, nil
}

func parseAmountMinor(value string, exponent int) (int64, bool) {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "-") || strings.HasPrefix(value, "+") {
		return 0, false
	}
	whole, fraction, hasFraction := strings.Cut(value, ".")
	if whole == "" {
		whole = "0"
	}
	if !hasFraction {
		fraction = ""
	}
	if len(fraction) > exponent || strings.Contains(fraction, ".") {
		return 0, false
	}
	for _, part := range []string{whole, fraction} {
		for _, char := range part {
			if char < '0' || char > '9' {
				return 0, false
			}
		}
	}
	var scale int64 = 1
	for range exponent {
		scale *= 10
	}
	var integer, decimal int64
	for _, char := range whole {
		if integer > (math.MaxInt64-int64(char-'0'))/10 {
			return 0, false
		}
		integer = integer*10 + int64(char-'0')
	}
	for _, char := range fraction {
		decimal = decimal*10 + int64(char-'0')
	}
	for range exponent - len(fraction) {
		decimal *= 10
	}
	if integer > (math.MaxInt64-decimal)/scale {
		return 0, false
	}
	return integer*scale + decimal, true
}

func HandleSplitTransaction(state *state.State, getUserID GetUserID) Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		userID, err := getUserID(r)
		if err != nil {
			return err
		}
		var body struct {
			ExpectedLatestPostingTimestamp string `json:"expected_latest_posting_timestamp"`
			Postings                       []struct {
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
		expectedLatestPostingTimestamp, err := time.Parse(time.RFC3339, body.ExpectedLatestPostingTimestamp)
		if err != nil {
			return NewErr("expected_latest_posting_timestamp must be an RFC3339 timestamp", http.StatusBadRequest)
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
		if err = state.Data.SplitTransaction(r.Context(), userID, r.PathValue("id"), expectedLatestPostingTimestamp, input); err != nil {
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
