package data

import (
	"context"
	"database/sql"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type Data struct {
	*Users
	*Sessions
}

func NewData(ctx context.Context, dbUrl string) (*Data, error) {
	db, err := connectPostgres(ctx, dbUrl)
	if err != nil {
		return nil, fmt.Errorf("error connecting to postgres: %w", err)
	}

	return &Data{
		Users:    NewUsers(db),
		Sessions: NewSessions(db),
	}, nil
}

func connectPostgres(ctx context.Context, dbUrl string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dbUrl)
	if err != nil {
		return nil, fmt.Errorf("error opening database: %w", err)
	}

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("error pinging database: %w", err)
	}

	if _, err := db.ExecContext(ctx, schema); err != nil {
		return nil, fmt.Errorf("error applying schema: %w", err)
	}

	return db, nil
}

const schema = `
create table if not exists users (
    id varchar(22) primary key,
    subject text not null,
    issuer text not null,
    email text not null,
    created_at timestamptz not null,
    unique (issuer, subject)
);

create table if not exists sessions (
    id varchar(22) primary key,
    user_id varchar(22) not null references users(id),
    created_at timestamptz not null
);
create index if not exists idx_sessions_user_id on sessions(user_id);
`
