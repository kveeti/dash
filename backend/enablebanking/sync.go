package enablebanking

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"money/backend/data"
)

const (
	syncWorkers     = 2
	syncMaxAttempts = 5
	syncWindowDays  = 90
	syncPoll        = time.Second
)

type Syncer struct {
	data   *data.Data
	client *Client
	kick   chan struct{}
}

func NewSyncer(d *data.Data, client *Client) *Syncer {
	return &Syncer{data: d, client: client, kick: make(chan struct{}, 1)}
}

func (s *Syncer) Start(ctx context.Context) {
	if err := s.data.RecoverEnableBankingSyncs(ctx); err != nil {
		slog.Error("Enable Banking sync recovery failed", "err", err)
	}
	for range syncWorkers {
		go s.worker(ctx)
	}
	s.Kick()
}

func (s *Syncer) Kick() {
	select {
	case s.kick <- struct{}{}:
	default:
	}
}

func (s *Syncer) worker(ctx context.Context) {
	ticker := time.NewTicker(syncPoll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.kick:
		case <-ticker.C:
		}
		for {
			job, ok, err := s.data.ClaimEnableBankingSync(ctx)
			if ctx.Err() != nil {
				return
			}
			if err != nil {
				slog.Error("claim Enable Banking sync", "err", err)
				break
			}
			if !ok {
				break
			}
			s.Kick() // wake another worker if more jobs are queued
			s.process(ctx, job)
		}
	}
}

func (s *Syncer) process(ctx context.Context, job data.EnableBankingSyncJob) {
	currencies, err := s.data.CurrencyExponents(ctx)
	if err != nil {
		s.retry(ctx, job, err)
		return
	}
	for !job.FetchedAll {
		daysToTarget := int(job.DateTo.Sub(job.DateFrom).Hours() / 24)
		windowTo := job.DateFrom.AddDate(0, 0, daysToTarget%syncWindowDays)
		var page TransactionPage
		if job.UseLongest {
			page, err = s.client.LongestTransactions(ctx, job.AccountUID, job.HistoryFrom.Format(time.DateOnly), job.ContinuationKey)
		} else {
			page, err = s.client.Transactions(ctx, job.AccountUID, job.DateFrom.Format(time.DateOnly), windowTo.Format(time.DateOnly), job.ContinuationKey)
		}
		if err != nil {
			var apiErr *APIError
			if errors.As(err, &apiErr) {
				newestWindowFrom := job.DateTo.AddDate(0, 0, -(syncWindowDays - 1))
				if newestWindowFrom.Before(job.HistoryFrom) {
					newestWindowFrom = job.HistoryFrom
				}
				if !job.UseLongest && apiErr.Code == "WRONG_TRANSACTIONS_PERIOD" &&
					job.ContinuationKey == "" && job.DateFrom.Before(newestWindowFrom) {
					if switchErr := s.data.UseLongestEnableBankingSync(ctx, job); switchErr != nil {
						s.retry(ctx, job, switchErr)
						return
					}
					slog.Info("Enable Banking explicit history limit reached; using longest strategy", "batch", job.BatchID, "date_from", job.DateFrom.Format(time.DateOnly))
					job.UseLongest = true
					continue
				}
				if apiErr.Code == "EXPIRED_SESSION" || apiErr.Code == "REVOKED_SESSION" {
					s.fail(ctx, job.BatchID, errors.New("bank connection needs re-authentication"))
					return
				}
				if apiErr.Status >= 400 && apiErr.Status < 500 && apiErr.Status != 408 && apiErr.Status != 429 {
					s.fail(ctx, job.BatchID, apiErr)
					return
				}
			}
			s.retry(ctx, job, err)
			return
		}
		rows, rowErrors := normalizeTransactions(page.Transactions, currencies, job.NextSequence)
		nextDateFrom := job.DateFrom
		fetchedAll := false
		if page.ContinuationKey == "" {
			if job.UseLongest {
				fetchedAll = true
			} else if job.DateFrom.After(job.HistoryFrom) {
				nextWindowTo := job.DateFrom.AddDate(0, 0, -1)
				nextDateFrom = nextWindowTo.AddDate(0, 0, -(syncWindowDays - 1))
				if nextDateFrom.Before(job.HistoryFrom) {
					nextDateFrom = job.HistoryFrom
				}
			} else {
				fetchedAll = true
			}
		}
		if err := s.data.StageEnableBankingPage(ctx, job, rows, rowErrors, page.ContinuationKey, nextDateFrom, fetchedAll); err != nil {
			if errors.Is(err, data.ErrBankSyncRepeatedContinuation) {
				s.fail(ctx, job.BatchID, err)
			} else {
				s.retry(ctx, job, err)
			}
			return
		}
		job.NextSequence += int64(len(rows))
		job.ContinuationKey = page.ContinuationKey
		job.DateFrom = nextDateFrom
		job.FetchedAll = fetchedAll
		job.Attempts = 0
	}

	var added, duplicates int
	for attempt := 0; attempt < syncMaxAttempts; attempt++ {
		added, duplicates, err = s.data.FinalizeEnableBankingSync(ctx, job.BatchID)
		if err == nil {
			slog.Info("Enable Banking sync done", "batch", job.BatchID, "added", added, "duplicates", duplicates)
			return
		}
		if ctx.Err() != nil {
			return
		}
		time.Sleep(time.Duration(attempt+1) * 200 * time.Millisecond)
	}
	s.fail(ctx, job.BatchID, err)
}

func (s *Syncer) retry(ctx context.Context, job data.EnableBankingSyncJob, cause error) {
	if job.Attempts+1 >= syncMaxAttempts {
		s.fail(ctx, job.BatchID, cause)
		return
	}
	delay := time.Second * time.Duration(1<<job.Attempts)
	if err := s.data.RetryEnableBankingSync(ctx, job.BatchID, time.Now().Add(delay), cause); err != nil {
		slog.Error("queue Enable Banking sync retry", "batch", job.BatchID, "err", err)
	}
}

func (s *Syncer) fail(ctx context.Context, batchID string, cause error) {
	if err := s.data.FailEnableBankingSync(ctx, batchID, cause); err != nil {
		slog.Error("fail Enable Banking sync", "batch", batchID, "err", err)
		return
	}
	slog.Error("Enable Banking sync failed", "batch", batchID, "err", cause)
}

func normalizeTransactions(transactions []Transaction, currencies map[string]int, firstSequence int64) ([]data.ParsedRow, []data.RowError) {
	rows := make([]data.ParsedRow, 0, len(transactions))
	var rowErrors []data.RowError
	for i, transaction := range transactions {
		if transaction.Status != "" && transaction.Status != "BOOK" {
			continue
		}
		line := int(firstSequence) + i + 1
		dateText := transaction.BookingDate
		if dateText == "" {
			dateText = transaction.TransactionDate
		}
		if dateText == "" {
			dateText = transaction.ValueDate
		}
		occurredOn, err := time.Parse(time.DateOnly, dateText)
		if err != nil {
			rowErrors = append(rowErrors, data.RowError{Line: line, Error: "invalid bank transaction date"})
			continue
		}
		rawAmount := strings.TrimSpace(transaction.TransactionAmount.Amount)
		rawAmount = strings.TrimPrefix(strings.TrimPrefix(rawAmount, "+"), "-")
		switch transaction.CreditDebitIndicator {
		case "DBIT":
			rawAmount = "-" + rawAmount
		case "CRDT":
		default:
			rowErrors = append(rowErrors, data.RowError{Line: line, Error: "invalid bank transaction direction"})
			continue
		}
		amount, currency, err := data.ParseCanonicalAmount(rawAmount, transaction.TransactionAmount.Currency, currencies)
		if err != nil {
			rowErrors = append(rowErrors, data.RowError{Line: line, Error: err.Error()})
			continue
		}
		counterparty := ""
		if transaction.CreditDebitIndicator == "DBIT" && transaction.Creditor != nil {
			counterparty = strings.TrimSpace(transaction.Creditor.Name)
		} else if transaction.Debtor != nil {
			counterparty = strings.TrimSpace(transaction.Debtor.Name)
		} else if transaction.Creditor != nil {
			counterparty = strings.TrimSpace(transaction.Creditor.Name)
		}
		counterpartyRemittance := -1
		if counterparty == "" {
			for i, information := range transaction.RemittanceInformation {
				if information = strings.TrimSpace(information); information != "" {
					counterparty = information
					counterpartyRemittance = i
					break
				}
			}
		}
		noteParts := make([]string, 0, len(transaction.RemittanceInformation)+1)
		seenText := map[string]bool{}
		if counterparty != "" {
			seenText[strings.ToLower(strings.Join(strings.Fields(counterparty), " "))] = true
		}
		addNote := func(note string) {
			note = strings.TrimSpace(note)
			key := strings.ToLower(strings.Join(strings.Fields(note), " "))
			if key != "" && !seenText[key] {
				noteParts = append(noteParts, note)
				seenText[key] = true
			}
		}
		addNote(transaction.Note)
		for i, information := range transaction.RemittanceInformation {
			if i != counterpartyRemittance {
				addNote(information)
			}
		}
		rows = append(rows, data.ParsedRow{
			OccurredOn: occurredOn, Amount: amount, Currency: currency,
			Counterparty: counterparty, Note: strings.Join(noteParts, "\n"),
		})
	}
	return rows, rowErrors
}
