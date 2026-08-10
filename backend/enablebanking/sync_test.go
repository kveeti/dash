package enablebanking

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestNormalizeTransactionsProducesCanonicalRows(t *testing.T) {
	debit := Transaction{CreditDebitIndicator: "DBIT", BookingDate: "2026-07-01", Status: "BOOK"}
	debit.TransactionAmount.Amount = "12.34"
	debit.TransactionAmount.Currency = "eur"
	debit.Creditor = &struct {
		Name string `json:"name"`
	}{Name: "Cafe"}
	credit := Transaction{CreditDebitIndicator: "CRDT", ValueDate: "2026-07-02", Status: "BOOK"}
	credit.TransactionAmount.Amount = "-100.00"
	credit.TransactionAmount.Currency = "EUR"
	credit.Debtor = &struct {
		Name string `json:"name"`
	}{Name: "Employer"}

	rows, errs := normalizeTransactions([]Transaction{debit, credit}, map[string]int{"EUR": 2}, 0)

	require.Empty(t, errs)
	require.Len(t, rows, 2)
	require.Equal(t, time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC), rows[0].OccurredOn)
	require.Equal(t, int64(-1234), rows[0].Amount)
	require.Equal(t, "EUR", rows[0].Currency)
	require.Equal(t, "Cafe", rows[0].Counterparty)
	require.Nil(t, rows[0].OccurredAt)
	require.Equal(t, int64(10000), rows[1].Amount)
	require.Equal(t, "Employer", rows[1].Counterparty)
}

func TestNormalizeTransactionsUsesRemittanceInformation(t *testing.T) {
	unnamed := Transaction{
		CreditDebitIndicator:  "DBIT",
		BookingDate:           "2025-10-23",
		Status:                "BOOK",
		Note:                  "Cash at Mbank Targ Sienny 7",
		RemittanceInformation: []string{"", "Cash at Mbank Targ Sienny 7", "Card ending 5421", "card ending 5421"},
	}
	unnamed.TransactionAmount.Amount = "28.48"
	unnamed.TransactionAmount.Currency = "EUR"

	named := Transaction{
		CreditDebitIndicator:  "DBIT",
		BookingDate:           "2025-10-22",
		Status:                "BOOK",
		Note:                  "Original note",
		RemittanceInformation: []string{"Cafe", "Invoice 123", "invoice 123", "Second line"},
	}
	named.TransactionAmount.Amount = "10.00"
	named.TransactionAmount.Currency = "EUR"
	named.Creditor = &struct {
		Name string `json:"name"`
	}{Name: "Cafe"}

	rows, errs := normalizeTransactions([]Transaction{unnamed, named}, map[string]int{"EUR": 2}, 0)

	require.Empty(t, errs)
	require.Equal(t, "Cash at Mbank Targ Sienny 7", rows[0].Counterparty)
	require.Equal(t, "Card ending 5421", rows[0].Note)
	require.Equal(t, "Cafe", rows[1].Counterparty)
	require.Equal(t, "Original note\nInvoice 123\nSecond line", rows[1].Note)
}

func TestNormalizeTransactionsReportsMalformedRows(t *testing.T) {
	transaction := Transaction{CreditDebitIndicator: "UNKNOWN", BookingDate: "bad", Status: "BOOK"}
	transaction.TransactionAmount.Amount = "12.34"
	transaction.TransactionAmount.Currency = "EUR"

	rows, errs := normalizeTransactions([]Transaction{transaction}, map[string]int{"EUR": 2}, 4)

	require.Empty(t, rows)
	require.Equal(t, 5, errs[0].Line)
	require.Equal(t, "invalid bank transaction date", errs[0].Error)
}
