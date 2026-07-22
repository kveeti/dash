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

	d, err := data.NewData(context.Background(), dsn, "", "")
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

func postingIDForTransaction(t *testing.T, app *testApp, transactionID string) string {
	t.Helper()
	var id string
	if err := app.d.Users.QueryRow("select id from postings where transaction_id=$1 and import_row_id is null order by created_at limit 1", transactionID).Scan(&id); err != nil {
		t.Fatalf("finding user posting: %v", err)
	}
	return id
}

func systemBucketID(t *testing.T, app *testApp, kind string) string {
	t.Helper()
	var id string
	if err := app.d.Users.QueryRow("select id from buckets where kind=$1 and hidden=true", kind).Scan(&id); err != nil {
		t.Fatalf("finding %s bucket: %v", kind, err)
	}
	return id
}

func postingTotals(t *testing.T, app *testApp) map[string]map[string]int64 {
	t.Helper()
	return queryPostingTotals(t, app, `select bucket_id,currency,sum(amount) from postings group by bucket_id,currency`)
}

func postingTotalsAt(t *testing.T, app *testApp, at time.Time) map[string]map[string]int64 {
	t.Helper()
	return queryPostingTotals(t, app, `select p.bucket_id,p.currency,sum(p.amount) from postings p
		join transactions t on t.id=p.transaction_id where t.occurred_at<=$1 group by p.bucket_id,p.currency`, at)
}

func queryPostingTotals(t *testing.T, app *testApp, query string, args ...any) map[string]map[string]int64 {
	t.Helper()
	rows, err := app.d.Users.Query(query, args...)
	if err != nil {
		t.Fatalf("querying posting totals: %v", err)
	}
	defer rows.Close()

	out := map[string]map[string]int64{}
	for rows.Next() {
		var bucketID, currency string
		var amount int64
		if err := rows.Scan(&bucketID, &currency, &amount); err != nil {
			t.Fatalf("scanning posting total: %v", err)
		}
		if out[bucketID] == nil {
			out[bucketID] = map[string]int64{}
		}
		out[bucketID][currency] = amount
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("reading posting totals: %v", err)
	}
	return out
}

func dsnForDB(base, dbName string) (string, error) {
	u, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	u.Path = "/" + dbName
	return u.String(), nil
}
