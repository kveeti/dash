package data

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

const (
	ecbHistoryURL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml"
	ecbRecentURL  = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"
	rateSyncEvery = 6 * time.Hour
)

type Rate struct {
	Date     time.Time
	Currency string
	Rate     string
}

type rateCopySource struct {
	rates []Rate
	i     int
}

func (s *rateCopySource) Next() bool {
	return s.i < len(s.rates)
}

func (s *rateCopySource) Values() ([]any, error) {
	r := s.rates[s.i]
	s.i++
	return []any{r.Date, r.Currency, r.Rate}, nil
}

func (s *rateCopySource) Err() error { return nil }

func parseECBRates(r io.Reader) ([]Rate, error) {
	decoder := xml.NewDecoder(r)
	var date time.Time
	var rates []Rate

	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return rates, nil
		}
		if err != nil {
			return nil, err
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "Cube" {
			continue
		}

		attrs := map[string]string{}
		for _, attr := range start.Attr {
			attrs[attr.Name.Local] = attr.Value
		}
		if value := attrs["time"]; value != "" {
			date, err = time.Parse("2006-01-02", value)
			if err != nil {
				return nil, fmt.Errorf("invalid ECB rate date %q: %w", value, err)
			}
			rates = append(rates, Rate{Date: date, Currency: "EUR", Rate: "1"})
			continue
		}
		if attrs["currency"] == "" || attrs["rate"] == "" || date.IsZero() {
			continue
		}
		value, ok := new(big.Rat).SetString(attrs["rate"])
		if !ok || value.Sign() <= 0 {
			return nil, fmt.Errorf("invalid ECB rate %q", attrs["rate"])
		}
		rates = append(rates, Rate{Date: date, Currency: strings.ToUpper(attrs["currency"]), Rate: attrs["rate"]})
	}
}

func (d *Data) upsertRates(ctx context.Context, rates []Rate) error {
	conn, err := d.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	return conn.Raw(func(driverConn any) error {
		pgxConn := driverConn.(*stdlib.Conn).Conn()
		tx, err := pgxConn.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)

		if _, err := tx.Exec(ctx, "create temp table rate_stage (date date, currency text, rate numeric) on commit drop"); err != nil {
			return err
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"rate_stage"}, []string{"date", "currency", "rate"}, &rateCopySource{rates: rates}); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into rates (date, currency, rate)
			select s.date, s.currency, s.rate from rate_stage s
			join currencies c on c.code = s.currency
			on conflict (date, currency) do update set rate = excluded.rate
			where rates.rate is distinct from excluded.rate`); err != nil {
			return err
		}
		return tx.Commit(ctx)
	})
}

func (d *Data) syncRates(ctx context.Context) error {
	var empty bool
	if err := d.db.QueryRowContext(ctx, "select not exists(select 1 from rates)").Scan(&empty); err != nil {
		return err
	}
	url := ecbRecentURL
	if empty {
		url = ecbHistoryURL
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := (&http.Client{Timeout: time.Minute}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ECB returned %s", resp.Status)
	}

	rates, err := parseECBRates(resp.Body)
	if err != nil {
		return err
	}
	if len(rates) == 0 {
		return fmt.Errorf("ECB returned no rates")
	}
	return d.upsertRates(ctx, rates)
}

func (d *Data) StartRateSync(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(rateSyncEvery)
		defer ticker.Stop()
		for {
			if err := d.syncRates(ctx); err != nil && ctx.Err() == nil {
				slog.Error("rate sync failed", "err", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}
