package data

import (
	"encoding/csv"
	"fmt"
	"io"
	"strings"
	"time"
)

var opHeaderCols = []string{
	"Kirjauspäivä", "Arvopäivä", "Määrä EUROA", "Laji", "Selitys",
	"Saaja/Maksaja", "Saajan tilinumero", "Saajan pankin BIC", "Viite",
	"Viesti", "Arkistointitunnus",
}

type OPParser struct {
	reader     *csv.Reader
	loc        *time.Location
	currencies map[string]int
	line       int
	row        ParsedRow
	errs       []RowError
	err        error
}

func NewOPParser(r io.Reader, loc *time.Location, currencies map[string]int) *OPParser {
	reader := csv.NewReader(r)
	reader.Comma = ';'
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	return &OPParser{reader: reader, loc: loc, currencies: currencies}
}

func (p *OPParser) Next() bool {
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
		row, err := parseOPRow(rec, p.loc, p.currencies)
		if err != nil {
			p.errs = append(p.errs, RowError{p.line, err.Error()})
			continue
		}
		p.row = row
		return true
	}
}

func (p *OPParser) Row() ParsedRow     { return p.row }
func (p *OPParser) Err() error         { return p.err }
func (p *OPParser) Errors() []RowError { return p.errs }

func ValidOPHeader(line string) bool {
	return validHeader(line, ";", opHeaderCols)
}

func parseOPRow(cols []string, loc *time.Location, currencies map[string]int) (ParsedRow, error) {
	col := func(i int) string {
		if i < len(cols) {
			return strings.TrimSpace(cols[i])
		}
		return ""
	}

	date, err := time.ParseInLocation("2006-01-02", col(0), loc)
	if err != nil {
		return ParsedRow{}, fmt.Errorf("invalid date: %s", col(0))
	}
	_, exponent, err := normalizeCurrency("EUR", currencies)
	if err != nil {
		return ParsedRow{}, err
	}
	amount, err := parseAmountToMinor(col(2), exponent)
	if err != nil {
		return ParsedRow{}, err
	}
	payee := col(5)
	if payee == "" {
		payee = "NONAME"
	}
	message := joinDescription([][2]string{
		{"Selitys", col(4)},
		{"Saajan tilinumero", col(6)},
		{"Viesti", strings.TrimPrefix(col(9), "Viesti:")},
	})

	return ParsedRow{
		Date: date, Amount: amount, Currency: "EUR", Payee: payee,
		Message: message, RawDescription: message,
		Raw: map[string]string{
			"payee": payee, "message": message, "description": col(4),
			"account": col(6), "bic": col(7), "reference": col(8),
			"bank_message": col(9), "archive_id": col(10),
		},
	}, nil
}

func validHeader(line, delimiter string, want []string) bool {
	line = decodeField(strings.TrimRight(line, "\r\n"))
	line = strings.TrimPrefix(line, string(rune(0xFEFF)))
	reader := csv.NewReader(strings.NewReader(line))
	reader.Comma = rune(delimiter[0])
	reader.FieldsPerRecord = -1
	cols, err := reader.Read()
	if err != nil || len(cols) < len(want) {
		return false
	}
	for i := range want {
		if strings.TrimSpace(cols[i]) != want[i] {
			return false
		}
	}
	return true
}
