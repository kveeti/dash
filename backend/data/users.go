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
	ID           string
	Subject      string
	Issuer       string
	Email        string
	HomeCurrency string
	CreatedAt    time.Time
}

// CreateUser inserts a new user together with their two hidden buckets (clearing
// and uncategorized) in one transaction, so a user never exists without them.
func (d *Data) CreateUser(ctx context.Context, user User) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		"insert into users (id, subject, issuer, email, created_at) values ($1, $2, $3, $4, $5)",
		user.ID, user.Subject, user.Issuer, user.Email, user.CreatedAt.UTC()); err != nil {
		return err
	}
	if err := auditWrite(ctx, tx, user.ID, "users", user.ID, "insert", nil); err != nil {
		return err
	}

	now := time.Now().UTC()
	for _, b := range []Bucket{
		{ID: NewPrivateID(), OwnerUserID: user.ID, Kind: KindClearing, Name: "Clearing", Hidden: true, CreatedAt: now},
		{ID: NewPrivateID(), OwnerUserID: user.ID, Kind: KindExpense, Name: "Uncategorized", Hidden: true, CreatedAt: now},
	} {
		if err := insertBucketTx(ctx, tx, b); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Users) GetUserByID(ctx context.Context, userID string) (*User, error) {
	return s.scanUser(s.QueryRowContext(ctx,
		"select id, subject, issuer, email, home_currency, created_at from users where id = $1 limit 1", userID))
}

// GetUserBySubject looks up a user by their OIDC issuer + subject identifier.
func (s *Users) GetUserBySubject(ctx context.Context, issuer, subject string) (*User, error) {
	return s.scanUser(s.QueryRowContext(ctx,
		"select id, subject, issuer, email, home_currency, created_at from users where issuer = $1 and subject = $2 limit 1", issuer, subject))
}

func (s *Users) scanUser(row *sql.Row) (*User, error) {
	var user User

	err := row.Scan(&user.ID, &user.Subject, &user.Issuer, &user.Email, &user.HomeCurrency, &user.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &user, nil
}
