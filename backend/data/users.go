package data

import (
	"context"
	"database/sql"
	"time"
)

type Users struct {
	*sql.DB
}

func NewUsers(s *sql.DB) *Users {
	return &Users{DB: s}
}

type User struct {
	ID        string
	Subject   string
	Issuer    string
	Email     string
	CreatedAt time.Time
}

func (s *Users) InsertUser(ctx context.Context, user User) error {
	_, err := s.ExecContext(ctx,
		"insert into users (id, subject, issuer, email, created_at) values ($1, $2, $3, $4, $5)",
		user.ID,
		user.Subject,
		user.Issuer,
		user.Email,
		user.CreatedAt.UTC(),
	)
	return err
}

func (s *Users) GetUserByID(ctx context.Context, userID string) (*User, error) {
	return s.scanUser(s.QueryRowContext(ctx,
		"select id, subject, issuer, email, created_at from users where id = $1 limit 1", userID))
}

// GetUserBySubject looks up a user by their OIDC issuer + subject identifier.
func (s *Users) GetUserBySubject(ctx context.Context, issuer, subject string) (*User, error) {
	return s.scanUser(s.QueryRowContext(ctx,
		"select id, subject, issuer, email, created_at from users where issuer = $1 and subject = $2 limit 1", issuer, subject))
}

func (s *Users) scanUser(row *sql.Row) (*User, error) {
	var user User

	err := row.Scan(&user.ID, &user.Subject, &user.Issuer, &user.Email, &user.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &user, nil
}
