package data

import (
	"encoding/csv"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var genericCSVHeader = []string{"date", "occurred_at", "amount", "currency", "counterparty", "note"}
var amountRe = regexp.MustCompile(`^(-?)(\d+)(?:\.(\d+))?$`)

type ParsedRow struct {
	OccurredOn   time.Time
	OccurredAt   *time.Time
	Amount       int64
	Currency     string
	Counterparty string
	Note         string
}

type RowError struct {
	Line  int    `json:"line"`
	Error string `json:"error"`
}

type GenericCSVParser struct {
	reader     *csv.Reader
	loc        *time.Location
	currencies map[string]int
	line       int
	row        ParsedRow
	errs       []RowError
	err        error
}

func NewGenericCSVParser(r io.Reader, loc *time.Location, currencies map[string]int) *GenericCSVParser {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1
	return &GenericCSVParser{reader: reader, loc: loc, currencies: currencies}
}

func (p *GenericCSVParser) Next() bool {
	for {
		record, err := p.reader.Read()
		if err == io.EOF {
			return false
		}
		p.line++
		if p.line == 1 {
			continue
		}
		if err != nil {
			if _, ok := err.(*csv.ParseError); ok {
				p.errs = append(p.errs, RowError{Line: p.line, Error: err.Error()})
				continue
			}
			p.err = err
			return false
		}
		row, err := parseGenericCSVRow(record, p.loc, p.currencies)
		if err != nil {
			p.errs = append(p.errs, RowError{Line: p.line, Error: err.Error()})
			continue
		}
		p.row = row
		return true
	}
}

func (p *GenericCSVParser) Row() ParsedRow     { return p.row }
func (p *GenericCSVParser) Err() error         { return p.err }
func (p *GenericCSVParser) Errors() []RowError { return p.errs }

func ValidGenericCSVHeader(line string) bool {
	reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(strings.TrimRight(line, "\r\n"), "\ufeff")))
	record, err := reader.Read()
	if err != nil || len(record) != len(genericCSVHeader) {
		return false
	}
	for i, expected := range genericCSVHeader {
		if strings.TrimSpace(strings.ToLower(record[i])) != expected {
			return false
		}
	}
	return true
}

func parseGenericCSVRow(columns []string, loc *time.Location, currencies map[string]int) (ParsedRow, error) {
	if len(columns) != len(genericCSVHeader) {
		return ParsedRow{}, fmt.Errorf("expected %d columns, got %d", len(genericCSVHeader), len(columns))
	}
	column := func(index int) string { return strings.TrimSpace(columns[index]) }

	var occurredAt *time.Time
	var sourceTime time.Time
	if value := column(1); value != "" {
		parsed, err := time.Parse(time.RFC3339, value)
		if err != nil {
			parsed, err = time.ParseInLocation("2006-01-02 15:04:05", value, loc)
			if err != nil {
				return ParsedRow{}, fmt.Errorf("invalid occurred_at: %s", value)
			}
		}
		sourceTime = parsed
		utc := parsed.UTC()
		occurredAt = &utc
	}

	var occurredOn time.Time
	if value := column(0); value != "" {
		parsed, err := time.Parse(time.DateOnly, value)
		if err != nil {
			return ParsedRow{}, fmt.Errorf("invalid date: %s", value)
		}
		occurredOn = parsed
	} else if occurredAt != nil {
		occurredOn = time.Date(sourceTime.Year(), sourceTime.Month(), sourceTime.Day(), 0, 0, 0, 0, time.UTC)
	} else {
		return ParsedRow{}, fmt.Errorf("date or occurred_at is required")
	}

	amount, currency, err := ParseCanonicalAmount(column(2), column(3), currencies)
	if err != nil {
		return ParsedRow{}, err
	}

	return ParsedRow{
		OccurredOn: occurredOn, OccurredAt: occurredAt, Amount: amount,
		Currency: currency, Counterparty: column(4), Note: column(5),
	}, nil
}

// ParseCanonicalAmount validates a currency and converts a decimal amount to
// the integer minor-unit representation used by imports.
func ParseCanonicalAmount(raw, rawCurrency string, currencies map[string]int) (int64, string, error) {
	currency, exponent, err := normalizeCurrency(rawCurrency, currencies)
	if err != nil {
		return 0, "", err
	}
	amount, err := parseAmountToMinor(raw, exponent)
	if err != nil {
		return 0, "", err
	}
	if amount == 0 {
		return 0, "", fmt.Errorf("amount must not be zero")
	}
	return amount, currency, nil
}

func normalizeCurrency(raw string, currencies map[string]int) (string, int, error) {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if code == "" {
		return "", 0, fmt.Errorf("currency is required")
	}
	exponent, ok := currencies[code]
	if !ok {
		return "", 0, fmt.Errorf("currency %s is not supported", code)
	}
	return code, exponent, nil
}

func parseAmountToMinor(raw string, exponent int) (int64, error) {
	cleaned := strings.NewReplacer("–", "-", "—", "-").Replace(raw)
	cleaned = strings.Join(strings.Fields(cleaned), "")
	cleaned = strings.ReplaceAll(cleaned, ",", ".")

	match := amountRe.FindStringSubmatch(cleaned)
	if match == nil {
		return 0, fmt.Errorf("invalid amount: %s", raw)
	}
	sign, integer, fraction := match[1], match[2], match[3]
	factor := int64(1)
	for range exponent {
		factor *= 10
	}
	fractionValue := "0"
	if exponent > 0 {
		fractionValue = (fraction + strings.Repeat("0", exponent))[:exponent]
	}
	integerNumber, err := strconv.ParseInt(integer, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("amount is too large: %s", raw)
	}
	fractionNumber, _ := strconv.ParseInt(fractionValue, 10, 64)
	if integerNumber > (1<<63-1-fractionNumber)/factor {
		return 0, fmt.Errorf("amount is too large: %s", raw)
	}
	minor := integerNumber*factor + fractionNumber
	if sign == "-" {
		minor = -minor
	}
	return minor, nil
}
