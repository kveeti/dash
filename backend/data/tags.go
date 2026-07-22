package data

import (
	"context"
	"errors"
	"strings"
)

var ErrInvalidTag = errors.New("tag cannot be empty")

const editablePostingTags = `p.import_row_id is null and not b.hidden and b.kind in ('expense','income')
	and not exists(select 1 from postings p3 join buckets b3 on b3.id=p3.bucket_id
		where p3.transaction_id=p.transaction_id and b3.kind='transit')`

func normalizeTag(tag string) string { return strings.ToLower(strings.TrimSpace(tag)) }

func (d *Data) AddPostingTag(ctx context.Context, userID string, postingIDs []string, tag string) (int, error) {
	tag = normalizeTag(tag)
	if tag == "" {
		return 0, ErrInvalidTag
	}
	if len(postingIDs) == 0 {
		return 0, nil
	}
	var requested, editable, added int
	err := d.db.QueryRowContext(ctx, `with requested as (select distinct unnest($2::uuid[]) id),
	editable as (select p.id from requested r join postings p on p.id=r.id
		join transactions t on t.id=p.transaction_id join buckets b on b.id=p.bucket_id
		where t.owner_user_id=$1 and `+editablePostingTags+`),
	added as (insert into posting_tags(id,posting_id,tag,created_at)
		select uuidv7(),id,$3,now() from editable
		where (select count(*) from requested)=(select count(*) from editable)
		on conflict(posting_id,tag) do nothing returning id),
	a as (insert into audit_logs select uuidv7(),$1,'posting_tags',id,'insert',null,now() from added)
	select (select count(*) from requested),(select count(*) from editable),(select count(*) from added)`, userID, postingIDs, tag).Scan(&requested, &editable, &added)
	if err != nil {
		return 0, err
	}
	if requested != editable {
		return 0, ErrPostingNotEditable
	}
	return added, nil
}
func (d *Data) RemovePostingTag(ctx context.Context, userID string, postingIDs []string, tag string) (int, error) {
	tag = normalizeTag(tag)
	if tag == "" {
		return 0, ErrInvalidTag
	}
	if len(postingIDs) == 0 {
		return 0, nil
	}
	var requested, editable, removed int
	err := d.db.QueryRowContext(ctx, `with requested as (select distinct unnest($2::uuid[]) id),
	editable as (select p.id from requested r join postings p on p.id=r.id
		join transactions t on t.id=p.transaction_id join buckets b on b.id=p.bucket_id
		where t.owner_user_id=$1 and `+editablePostingTags+`),
	doomed as materialized(select pt.* from posting_tags pt join editable e on e.id=pt.posting_id
		where pt.tag=$3 and (select count(*) from requested)=(select count(*) from editable)),
	a as (insert into audit_logs select uuidv7(),$1,'posting_tags',id,'delete',to_jsonb(doomed),now() from doomed),
	d as (delete from posting_tags where id in(select id from doomed) returning id)
	select (select count(*) from requested),(select count(*) from editable),(select count(*) from d)`, userID, postingIDs, tag).Scan(&requested, &editable, &removed)
	if err != nil {
		return 0, err
	}
	if requested != editable {
		return 0, ErrPostingNotEditable
	}
	return removed, nil
}
func (d *Data) ListTags(ctx context.Context, userID, q string) ([]string, error) {
	q = normalizeTag(q)
	rows, err := d.db.QueryContext(ctx, `select distinct pt.tag from posting_tags pt join postings p on p.id=pt.posting_id join transactions t on t.id=p.transaction_id join buckets b on b.id=p.bucket_id where t.owner_user_id=$1 and b.hidden=false and ($2='' or pt.tag like '%'||$2||'%') order by pt.tag limit 50`, userID, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var tag string
		if err = rows.Scan(&tag); err != nil {
			return nil, err
		}
		out = append(out, tag)
	}
	return out, rows.Err()
}
