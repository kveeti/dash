package data

import (
	"context"
	"database/sql"
)

type Currency struct {
	Code     string
	Exponent int
}

func (d *Data) ListCurrencies(ctx context.Context) ([]Currency, error) {
	rows, err := d.db.QueryContext(ctx, `
		select code, exponent
		from currencies
		order by code
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var currencies []Currency
	for rows.Next() {
		var currency Currency
		if err := rows.Scan(&currency.Code, &currency.Exponent); err != nil {
			return nil, err
		}
		currencies = append(currencies, currency)
	}
	return currencies, rows.Err()
}

func (d *Data) CurrencyExponents(ctx context.Context) (map[string]int, error) {
	currencies, err := d.ListCurrencies(ctx)
	if err != nil {
		return nil, err
	}
	exponents := make(map[string]int, len(currencies))
	for _, currency := range currencies {
		exponents[currency.Code] = currency.Exponent
	}
	return exponents, nil
}

func validatePostingCurrencies(ctx context.Context, tx *sql.Tx, postings []Posting) error {
	codes := make([]string, 0, len(postings))
	seen := map[string]bool{}
	for _, posting := range postings {
		if !seen[posting.Currency] {
			seen[posting.Currency] = true
			codes = append(codes, posting.Currency)
		}
	}
	var count int
	if err := tx.QueryRowContext(ctx, `
		select count(*)
		from currencies
		where code = any($1)
	`, codes).Scan(&count); err != nil {
		return err
	}
	if count != len(codes) {
		return ErrInvalidCurrency
	}
	return nil
}
