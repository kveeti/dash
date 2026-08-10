package data

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestGenericCSVDateAndTimestampRows(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Helsinki")
	require.NoError(t, err)
	input := `date,occurred_at,amount,currency,counterparty,note
2026-07-01,,-12.34,EUR,Cafe,Lunch
,2026-07-02 00:30:00,10.00,EUR,Friend,Refund
2026-07-03,2026-07-02T21:30:00-04:00,-5.00,EUR,Shop,
`
	parser := NewGenericCSVParser(strings.NewReader(input), loc, map[string]int{"EUR": 2})
	var rows []ParsedRow
	for parser.Next() {
		rows = append(rows, parser.Row())
	}
	require.NoError(t, parser.Err())
	require.Empty(t, parser.Errors())
	require.Len(t, rows, 3)

	require.Equal(t, "2026-07-01", rows[0].OccurredOn.Format(time.DateOnly))
	require.Nil(t, rows[0].OccurredAt)
	require.Equal(t, int64(-1234), rows[0].Amount)
	require.Equal(t, "Lunch", rows[0].Note)

	require.Equal(t, "2026-07-02", rows[1].OccurredOn.Format(time.DateOnly))
	require.NotNil(t, rows[1].OccurredAt)
	require.Equal(t, "2026-07-01T21:30:00Z", rows[1].OccurredAt.Format(time.RFC3339))

	// An explicit date remains authoritative while the exact instant is kept.
	require.Equal(t, "2026-07-03", rows[2].OccurredOn.Format(time.DateOnly))
	require.Equal(t, "2026-07-03T01:30:00Z", rows[2].OccurredAt.Format(time.RFC3339))
}

func TestGenericCSVCollectsInvalidRows(t *testing.T) {
	input := `date,occurred_at,amount,currency,counterparty,note
,,-1.00,EUR,Missing date,
2026-07-01,,0,EUR,Zero,
2026-07-02,,-2.00,EUR,Valid,
`
	parser := NewGenericCSVParser(strings.NewReader(input), time.UTC, map[string]int{"EUR": 2})
	require.True(t, parser.Next())
	require.Equal(t, "Valid", parser.Row().Counterparty)
	require.False(t, parser.Next())
	require.NoError(t, parser.Err())
	require.Len(t, parser.Errors(), 2)
	require.Equal(t, 2, parser.Errors()[0].Line)
	require.Equal(t, 3, parser.Errors()[1].Line)
}

func TestValidGenericCSVHeader(t *testing.T) {
	require.True(t, ValidGenericCSVHeader("date,occurred_at,amount,currency,counterparty,note\n"))
	require.True(t, ValidGenericCSVHeader("\ufeffDate,Occurred_At,Amount,Currency,Counterparty,Note\r\n"))
	require.False(t, ValidGenericCSVHeader("date,amount,counterparty\n"))
}
