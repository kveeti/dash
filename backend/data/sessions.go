package data

import (
	"context"
	"database/sql"
	"time"
)

type Sessions struct {
	*sql.DB
}

func NewSessions(s *sql.DB) *Sessions {
	return &Sessions{DB: s}
}

type Session struct {
	ID        string
	UserID    string
	TokenHash string
	CreatedAt time.Time
	ExpiresAt time.Time
}

func (s *Sessions) InsertSession(ctx context.Context, session Session) error {
	_, err := s.ExecContext(ctx, `
		insert into sessions (id, user_id, token_hash, created_at, expires_at)
		values ($1, $2, $3, $4, $5)
	`, session.ID, session.UserID, session.TokenHash, session.CreatedAt.UTC(), session.ExpiresAt.UTC())
	return err
}

// GetSessionByTokenHash returns the unexpired session matching the token hash,
// or nil if none exists or it has expired.
func (s *Sessions) GetSessionByTokenHash(ctx context.Context, tokenHash string) (*Session, error) {
	var session Session

	err := s.QueryRowContext(ctx, `
		select id, user_id, token_hash, created_at, expires_at
		from sessions
		where token_hash = $1
		  and expires_at > $2
		limit 1
	`, tokenHash, time.Now().UTC()).Scan(
		&session.ID, &session.UserID, &session.TokenHash, &session.CreatedAt, &session.ExpiresAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &session, nil
}

func (s *Sessions) DeleteSession(ctx context.Context, sessionID string) error {
	_, err := s.ExecContext(ctx, `
		delete from sessions
		where id = $1
	`, sessionID)
	return err
}
