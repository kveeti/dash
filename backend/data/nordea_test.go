package data

import (
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

const testHeader = "Kirjauspäivä;Määrä;Arvopäivä;Maksupäivä;Tapahtuma;Saaja/Maksaja;Viesti;Viitenumero;Tilinumero;Valuutta\n"

// row builds a Nordea line: date;amount;;;;payee;message;reference;;currency
func row(date, amount, payee, message, reference, currency string) string {
	return strings.Join([]string{date, amount, "", "", "", payee, message, reference, "", currency}, ";") + "\n"
}

func parseAll(t *testing.T, r io.Reader) (*NordeaParser, []ParsedRow) {
	t.Helper()
	p := NewNordeaParser(r, time.UTC)
	var rows []ParsedRow
	for p.Next() {
		rows = append(rows, p.Row())
	}
	return p, rows
}

func TestNordeaValid(t *testing.T) {
	csv := testHeader +
		row("2026/07/01", "-12,34", "K-Market", "Groceries", "REF1", "EUR") +
		row("2026/07/02", "100,00", "Employer", "Salary", "", "")

	p, rows := parseAll(t, strings.NewReader(csv))
	require.NoError(t, p.Err())
	require.Empty(t, p.Errors())
	require.Len(t, rows, 2)

	require.Equal(t, "2026-07-01", rows[0].Date.Format("2006-01-02"))
	require.Equal(t, int64(-1234), rows[0].Amount)
	require.Equal(t, "EUR", rows[0].Currency)
	require.Equal(t, "K-Market", rows[0].Payee)
	require.Equal(t, "Groceries", rows[0].Message)
	require.Equal(t, "Viesti: Groceries, Viitenumero: REF1", rows[0].RawDescription)

	require.Equal(t, int64(10000), rows[1].Amount)
	require.Equal(t, "EUR", rows[1].Currency) // default when column empty
	require.Equal(t, "Employer", rows[1].Payee)
}

func TestNordeaDateInTimezone(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Helsinki")
	require.NoError(t, err)

	p := NewNordeaParser(strings.NewReader(testHeader+row("2026/07/01", "1,00", "X", "", "", "EUR")), loc)
	require.True(t, p.Next())

	// Midnight Helsinki (summer, UTC+3) is 2026-06-30T21:00:00Z.
	require.Equal(t, "2026-06-30T21:00:00Z", p.Row().Date.UTC().Format(time.RFC3339))
}

func TestNordeaBadRowsSkipped(t *testing.T) {
	csv := testHeader +
		row("2026/07/01", "-12,34", "K-Market", "Groceries", "", "EUR") + // line 2 ok
		row("bad-date", "-1,00", "Broken", "x", "", "EUR") + // line 3 bad date
		row("2026/07/03", "5,00", "Zap", "y", "", "XYZ") + // line 4 bad currency
		row("2026/07/04", "garbage", "Junk", "z", "", "EUR") + // line 5 bad amount
		row("2026/07/05", "50,00", "Refund", "w", "", "EUR") // line 6 ok

	p, rows := parseAll(t, strings.NewReader(csv))
	require.NoError(t, p.Err())
	require.Len(t, rows, 2)
	require.Equal(t, "K-Market", rows[0].Payee)
	require.Equal(t, "Refund", rows[1].Payee)

	errs := p.Errors()
	require.Len(t, errs, 3)
	require.Equal(t, 3, errs[0].Line)
	require.Equal(t, 4, errs[1].Line)
	require.Equal(t, 5, errs[2].Line)
}

func TestNordeaLatin1Field(t *testing.T) {
	line := "2026/07/01;-1,00;;;;" + string([]byte{0x50, 0xE4, 0x69, 0x76, 0xE4}) + ";msg;;;EUR\n" // "Päivä" latin-1
	csv := testHeader + line

	p, rows := parseAll(t, strings.NewReader(csv))
	require.NoError(t, p.Err())
	require.Empty(t, p.Errors())
	require.Len(t, rows, 1)
	require.Equal(t, "Päivä", rows[0].Payee)
}

func TestNordeaMixedEncoding(t *testing.T) {
	// UTF-8 payee, latin-1 message in the same record.
	line := "2026/07/01;-1,00;;;;Kääriäinen;" + string([]byte{0x63, 0x61, 0x66, 0xE9}) + ";;;EUR\n" // "café" latin-1
	csv := testHeader + line

	p, rows := parseAll(t, strings.NewReader(csv))
	require.NoError(t, p.Err())
	require.Empty(t, p.Errors())
	require.Len(t, rows, 1)
	require.Equal(t, "Kääriäinen", rows[0].Payee)
	require.Equal(t, "café", rows[0].Message)
}

func TestNordeaHeaderOnly(t *testing.T) {
	p, rows := parseAll(t, strings.NewReader(testHeader))
	require.NoError(t, p.Err())
	require.Empty(t, p.Errors())
	require.Empty(t, rows)
}

func TestNordeaEmpty(t *testing.T) {
	p, rows := parseAll(t, strings.NewReader(""))
	require.NoError(t, p.Err())
	require.Empty(t, p.Errors())
	require.Empty(t, rows)
}

type failingReader struct {
	data []byte
	pos  int
}

func (f *failingReader) Read(p []byte) (int, error) {
	if f.pos >= len(f.data) {
		return 0, errors.New("boom")
	}
	n := copy(p, f.data[f.pos:])
	f.pos += n
	return n, nil
}

func TestNordeaFatalReaderError(t *testing.T) {
	// Header + one full line, then the reader fails before EOF.
	csv := testHeader + row("2026/07/01", "-1,00", "K", "m", "", "EUR")
	p, _ := parseAll(t, &failingReader{data: []byte(csv)})
	require.Error(t, p.Err())
	require.Contains(t, p.Err().Error(), "boom")
}
