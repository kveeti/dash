package data

import "context"

type Balance struct {
	BucketID string
	Currency string
	Amount   int64
}

// GetBalances returns each bucket's balance per currency over the user's visible
// postings. Currencies are never blended; a bucket holding two currencies yields
// two rows.
func (d *Data) GetBalances(ctx context.Context, userID string) ([]Balance, error) {
	rows, err := d.db.QueryContext(ctx,
		`select p.bucket_id, p.currency, sum(p.amount)
		 from postings p
		 where `+visiblePostings+`
		 group by p.bucket_id, p.currency
		 order by p.bucket_id, p.currency`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var balances []Balance
	for rows.Next() {
		var b Balance
		if err := rows.Scan(&b.BucketID, &b.Currency, &b.Amount); err != nil {
			return nil, err
		}
		balances = append(balances, b)
	}
	return balances, rows.Err()
}
