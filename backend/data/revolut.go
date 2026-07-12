package data

import (
	"encoding/csv"
	"fmt"
	"io"
	"strings"
	"time"
)

var revolutHeaderCols = []string{
	"Type", "Product", "Started Date", "Completed Date", "Description",
	"Amount", "Fee", "Currency", "State", "Balance",
}

type RevolutParser struct {
	reader *csv.Reader
	loc    *time.Location
	line   int
	row    ParsedRow
	errs   []RowError
	err    error
}

func NewRevolutParser(r io.Reader, loc *time.Location) *RevolutParser {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	return &RevolutParser{reader: reader, loc: loc}
}

func (p *RevolutParser) Next() bool {
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
		row, completed, err := parseRevolutRow(rec, p.loc)
		if err != nil {
			p.errs = append(p.errs, RowError{p.line, err.Error()})
			continue
		}
		if !completed {
			continue
		}
		p.row = row
		return true
	}
}

func (p *RevolutParser) Row() ParsedRow     { return p.row }
func (p *RevolutParser) Err() error         { return p.err }
func (p *RevolutParser) Errors() []RowError { return p.errs }

func ValidRevolutHeader(line string) bool {
	return validHeader(line, ",", revolutHeaderCols)
}

func parseRevolutRow(cols []string, _ *time.Location) (ParsedRow, bool, error) {
	col := func(i int) string {
		if i < len(cols) {
			return strings.TrimSpace(cols[i])
		}
		return ""
	}

	if strings.ToUpper(col(8)) != "COMPLETED" {
		return ParsedRow{}, false, nil
	}
	dateText := col(2)
	date, err := time.ParseInLocation("2006-01-02 15:04:05", dateText, time.UTC)
	if err != nil {
		return ParsedRow{}, false, fmt.Errorf("invalid date: %s", dateText)
	}
	currency, err := normalizeCurrency(col(7))
	if err != nil {
		return ParsedRow{}, false, err
	}
	amount, err := parseAmountToMinor(col(5), currencyExponents[currency])
	if err != nil {
		return ParsedRow{}, false, err
	}
	fee := int64(0)
	if col(6) != "" {
		fee, err = parseAmountToMinor(col(6), currencyExponents[currency])
		if err != nil {
			return ParsedRow{}, false, err
		}
		if fee < 0 {
			fee = -fee
		}
	}
	amount -= fee
	payee := col(4)
	if payee == "" {
		payee = "NONAME"
	}
	feeDescription := ""
	if fee != 0 {
		feeDescription = col(6)
	}
	message := joinDescription([][2]string{{"Type", col(0)}, {"Fee", feeDescription}})

	return ParsedRow{
		Date: date, Amount: amount, Currency: currency, Payee: payee,
		Message: message, RawDescription: message,
		Raw: map[string]string{
			"type": col(0), "product": col(1), "started_at": col(2),
			"completed_at": col(3), "payee": payee, "message": message,
			"fee": col(6), "state": col(8), "balance": col(9),
		},
	}, true, nil
}
