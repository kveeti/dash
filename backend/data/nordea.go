package data

import (
	"encoding/csv"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Supported currencies and their minor-unit exponents. A code outside this list
// fails the row (not the batch) so the user sees which currency to add.
var currencyExponents = map[string]int{
	"EUR": 2, "USD": 2, "GBP": 2, "JPY": 0, "CHF": 2,
	"AUD": 2, "CAD": 2, "SEK": 2, "NOK": 2, "DKK": 2, "PLN": 2,
}

type ParsedRow struct {
	Date           time.Time
	Amount         int64
	Currency       string
	Payee          string
	Message        string
	Balance        string
	RawDescription string
	Raw            map[string]string
}

type RowError struct {
	Line  int    `json:"line"`
	Error string `json:"error"`
}

var (
	nordeaDateRe = regexp.MustCompile(`^(\d{4})/(\d{2})/(\d{2})$`)
	amountRe     = regexp.MustCompile(`^(-?)(\d+)(?:\.(\d+))?$`)
)

// NordeaParser pulls parsed rows out of a Nordea CSV export (';'-delimited, first
// line a header) one at a time. Per-row parse errors are collected with their
// 1-based line and never abort; an underlying reader error is fatal (Err).
type NordeaParser struct {
	reader *csv.Reader
	line   int
	row    ParsedRow
	errs   []RowError
	err    error
}

func NewNordeaParser(r io.Reader) *NordeaParser {
	reader := csv.NewReader(r)
	reader.Comma = ';'
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	return &NordeaParser{reader: reader}
}

func (p *NordeaParser) Next() bool {
	for {
		rec, err := p.reader.Read()
		if err == io.EOF {
			return false
		}
		p.line++
		if p.line == 1 {
			continue
		}
		if err != nil {
			if _, ok := err.(*csv.ParseError); ok {
				p.errs = append(p.errs, RowError{p.line, err.Error()})
				continue
			}
			p.err = err
			return false
		}
		for i, field := range rec {
			rec[i] = decodeField(field)
		}
		row, perr := parseNordeaRow(rec)
		if perr != nil {
			p.errs = append(p.errs, RowError{p.line, perr.Error()})
			continue
		}
		p.row = row
		return true
	}
}

func (p *NordeaParser) Row() ParsedRow     { return p.row }
func (p *NordeaParser) Err() error         { return p.err }
func (p *NordeaParser) Errors() []RowError { return p.errs }

// nordeaHeaderCols are the first ten columns of a Nordea CSV export, in order.
// The real export ends with a trailing ';' (an 11th empty field) — we validate a
// prefix, so that and any future trailing columns are tolerated.
var nordeaHeaderCols = []string{
	"Kirjauspäivä", "Määrä", "Maksaja", "Maksunsaaja", "Nimi",
	"Otsikko", "Viesti", "Viitenumero", "Saldo", "Valuutta",
}

// ValidNordeaHeader reports whether line is a Nordea CSV header, tolerating a
// UTF-8 BOM, latin-1 encoding and the export's trailing ';'. Lets the ingest
// handler reject a non-Nordea file before storing it.
func ValidNordeaHeader(line string) bool {
	line = decodeField(strings.TrimRight(line, "\r\n"))
	line = strings.TrimPrefix(line, string(rune(0xFEFF)))
	cols := strings.Split(line, ";")
	if len(cols) < len(nordeaHeaderCols) {
		return false
	}
	for i, want := range nordeaHeaderCols {
		if strings.TrimSpace(cols[i]) != want {
			return false
		}
	}
	return true
}

func parseNordeaRow(cols []string) (ParsedRow, error) {
	col := func(i int) string {
		if i < len(cols) {
			return strings.TrimSpace(cols[i])
		}
		return ""
	}

	m := nordeaDateRe.FindStringSubmatch(col(0))
	if m == nil {
		return ParsedRow{}, fmt.Errorf("invalid date: %s", col(0))
	}
	date, err := time.Parse("2006-01-02", m[1]+"-"+m[2]+"-"+m[3])
	if err != nil {
		return ParsedRow{}, fmt.Errorf("invalid date: %s", col(0))
	}

	currency, err := normalizeCurrency(col(9))
	if err != nil {
		return ParsedRow{}, err
	}
	amount, err := parseAmountToMinor(col(1), currencyExponents[currency])
	if err != nil {
		return ParsedRow{}, err
	}

	payee := col(5)
	if payee == "" {
		payee = "NONAME"
	}
	message := col(6)
	reference := col(7)
	balance := col(8)

	raw := map[string]string{"payee": payee, "message": message, "reference": reference}
	if balance != "" {
		raw["balance"] = balance
	}

	return ParsedRow{
		Date:     date,
		Amount:   amount,
		Currency: currency,
		Payee:    payee,
		Message:  message,
		Balance:  balance,
		RawDescription: joinDescription([][2]string{
			{"Viesti", message},
			{"Viitenumero", reference},
		}),
		Raw: raw,
	}, nil
}

func normalizeCurrency(raw string) (string, error) {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if code == "" {
		return "EUR", nil
	}
	if _, ok := currencyExponents[code]; !ok {
		return "", fmt.Errorf("currency %s is not supported", code)
	}
	return code, nil
}

// parseAmountToMinor turns "-12,34" / "1 234.56" into signed minor units using
// integer math only, so cents stay exact. Fractional digits beyond the exponent
// are truncated, fewer are zero-padded.
func parseAmountToMinor(raw string, exponent int) (int64, error) {
	cleaned := strings.NewReplacer("–", "-", "—", "-").Replace(raw)
	cleaned = strings.Join(strings.Fields(cleaned), "")
	cleaned = strings.ReplaceAll(cleaned, ",", ".")

	m := amountRe.FindStringSubmatch(cleaned)
	if m == nil {
		return 0, fmt.Errorf("invalid amount: %s", raw)
	}
	sign, intPart, fracRaw := m[1], m[2], m[3]

	factor := int64(1)
	for range exponent {
		factor *= 10
	}
	fracPart := "0"
	if exponent > 0 {
		fracPart = (fracRaw + strings.Repeat("0", exponent))[:exponent]
	}

	intVal, _ := strconv.ParseInt(intPart, 10, 64)
	fracVal, _ := strconv.ParseInt(fracPart, 10, 64)
	minor := intVal*factor + fracVal
	if sign == "-" {
		return -minor, nil
	}
	return minor, nil
}

func joinDescription(parts [][2]string) string {
	var out []string
	for _, p := range parts {
		if v := strings.TrimSpace(p[1]); v != "" {
			out = append(out, p[0]+": "+v)
		}
	}
	return strings.Join(out, ", ")
}

// decodeField keeps a valid UTF-8 field as-is, else decodes it as latin-1 (each
// byte a code point). The csv tokenizer only cares about ';', '"', '\n' — all
// ASCII — so latin-1 high bytes never collide with it.
func decodeField(field string) string {
	if utf8.ValidString(field) {
		return field
	}
	runes := make([]rune, len(field))
	for i := 0; i < len(field); i++ {
		runes[i] = rune(field[i])
	}
	return string(runes)
}
