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
	CreatedAt time.Time
}

func (s *Sessions) InsertSession(ctx context.Context, session Session) error {
	_, err := s.ExecContext(ctx,
		"insert into sessions (id, user_id, created_at) values ($1, $2, $3)",
		session.ID,
		session.UserID,
		session.CreatedAt.UTC(),
	)
	return err
}

func (s *Sessions) GetSessionByIDAndUserID(ctx context.Context, sessionID, userID string) (*Session, error) {
	var session Session

	err := s.
		QueryRowContext(ctx, "select id, user_id, created_at from sessions where id = $1 and user_id = $2 limit 1", sessionID, userID).
		Scan(&session.ID, &session.UserID, &session.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &session, nil
}

func (s *Sessions) DeleteSession(ctx context.Context, sessionID string) error {
	_, err := s.ExecContext(ctx, "delete from sessions where id = $1", sessionID)
	return err
}
