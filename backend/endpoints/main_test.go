package endpoints

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net/url"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"money/backend/data"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// Tests share one Postgres instance and create a fresh database per test (see
// newTestData) so they stay isolated without a container each.
//
// Set TEST_DB_URL to point at an existing Postgres (e.g. the nix dev-shell one
// running natively); the connecting role must be allowed to CREATE DATABASE.
// If TEST_DB_URL is unset, a throwaway Postgres container is started (Docker).
var (
	adminDB   *sql.DB
	baseDSN   string
	dbCounter int64
)

func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))

	ctx := context.Background()

	var terminate func()
	if dsn := os.Getenv("TEST_DB_URL"); dsn != "" {
		baseDSN = dsn
	} else {
		container, err := postgres.Run(ctx, "postgres:16-alpine",
			postgres.WithDatabase("postgres"),
			postgres.WithUsername("postgres"),
			postgres.WithPassword("postgres"),
			testcontainers.WithWaitStrategy(
				wait.ForLog("database system is ready to accept connections").
					WithOccurrence(2).
					WithStartupTimeout(60*time.Second)),
		)
		if err != nil {
			log.Fatalf("starting postgres container (set TEST_DB_URL to use an existing instance): %v", err)
		}
		baseDSN, err = container.ConnectionString(ctx, "sslmode=disable")
		if err != nil {
			log.Fatalf("getting connection string: %v", err)
		}
		terminate = func() { _ = container.Terminate(ctx) }
	}

	var err error
	adminDB, err = sql.Open("pgx", baseDSN)
	if err != nil {
		log.Fatalf("opening admin db: %v", err)
	}
	if err := adminDB.Ping(); err != nil {
		log.Fatalf("pinging test db: %v", err)
	}

	code := m.Run()

	adminDB.Close()
	if terminate != nil {
		terminate()
	}
	os.Exit(code)
}

// newTestData creates a fresh database on the shared Postgres instance, applies
// the schema and returns a Data handle. The database is dropped on cleanup.
func newTestData(t *testing.T) *data.Data {
	t.Helper()

	name := fmt.Sprintf("test_%d_%d", os.Getpid(), atomic.AddInt64(&dbCounter, 1))
	if _, err := adminDB.Exec("create database " + name); err != nil {
		t.Fatalf("creating test db: %v", err)
	}

	dsn, err := dsnForDB(baseDSN, name)
	if err != nil {
		t.Fatalf("building dsn: %v", err)
	}

	d, err := data.NewData(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connecting test db: %v", err)
	}

	t.Cleanup(func() {
		d.Users.Close()
		if _, err := adminDB.Exec("drop database if exists " + name + " with (force)"); err != nil {
			t.Logf("dropping test db %s: %v", name, err)
		}
	})

	return d
}

func dsnForDB(base, dbName string) (string, error) {
	u, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	u.Path = "/" + dbName
	return u.String(), nil
}
