package data

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

var ErrInvalidTag = errors.New("tag cannot be empty")

func normalizeTag(tag string) string {
	return strings.ToLower(strings.TrimSpace(tag))
}

func (d *Data) AddTransactionTag(ctx context.Context, userID string, transactionIDs []string, tag string) (int, error) {
	tag = normalizeTag(tag)
	if tag == "" {
		return 0, ErrInvalidTag
	}
	if len(transactionIDs) == 0 {
		return 0, nil
	}

	var count int
	err := d.db.QueryRowContext(ctx, `with visible as (
		select distinct p.transaction_id
		from postings p
		where `+visiblePostings+` and p.transaction_id = any($2::uuid[])
	), added as (
		insert into transaction_tags (id, transaction_id, tag, created_at)
		select uuidv7(), transaction_id, $3, now() from visible
		on conflict (transaction_id, tag) do nothing
		returning id
	), audited as (
		insert into audit_logs (id, actor_user_id, table_name, row_id, operation, before, created_at)
		select uuidv7(), $1, 'transaction_tags', id, 'insert', null, now() from added
	)
	select count(*) from added`, userID, transactionIDs, tag).Scan(&count)
	return count, err
}

func (d *Data) RemoveTransactionTag(ctx context.Context, userID string, transactionIDs []string, tag string) (int, error) {
	tag = normalizeTag(tag)
	if tag == "" {
		return 0, ErrInvalidTag
	}
	if len(transactionIDs) == 0 {
		return 0, nil
	}

	var count int
	err := d.db.QueryRowContext(ctx, `with doomed as materialized (
		select tt.* from transaction_tags tt
		where tt.transaction_id = any($2::uuid[]) and tt.tag = $3
		and exists (select 1 from postings p where p.transaction_id = tt.transaction_id and `+visiblePostings+`)
	), audited as (
		insert into audit_logs (id, actor_user_id, table_name, row_id, operation, before, created_at)
		select uuidv7(), $1, 'transaction_tags', id, 'delete', to_jsonb(doomed), now() from doomed
	), deleted as (
		delete from transaction_tags tt using doomed
		where tt.id = doomed.id
		returning tt.id
	)
	select count(*) from deleted`, userID, transactionIDs, tag).Scan(&count)
	return count, err
}

func (d *Data) ListTags(ctx context.Context, userID, q string) ([]string, error) {
	q = normalizeTag(q)
	rows, err := d.db.QueryContext(ctx, `select distinct tt.tag
		from transaction_tags tt
		join postings p on p.transaction_id = tt.transaction_id
		where `+visiblePostings+` and ($2 = '' or tt.tag like '%' || $2 || '%')
		order by tt.tag`, userID, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tags := []string{}
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, rows.Err()
}

func loadTransactionTags(ctx context.Context, tx *sql.Tx, transactionID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, "select tag from transaction_tags where transaction_id = $1 order by tag", transactionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tags := []string{}
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, rows.Err()
}

func deleteTransactionTags(ctx context.Context, tx *sql.Tx, userID, transactionID string) error {
	_, err := tx.ExecContext(ctx, `with doomed as materialized (
		select * from transaction_tags where transaction_id = $2
	), audited as (
		insert into audit_logs (id, actor_user_id, table_name, row_id, operation, before, created_at)
		select uuidv7(), $1, 'transaction_tags', id, 'delete', to_jsonb(doomed), now() from doomed
	)
	delete from transaction_tags tt using doomed where tt.id = doomed.id`, userID, transactionID)
	return err
}
