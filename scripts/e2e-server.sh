#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
database="dash_e2e"
pg_port="${PGPORT:-5557}"
backend_port="${E2E_PORT:-8200}"
idp_port="${E2E_DEVIDP_PORT:-5758}"
admin_url="postgres://postgres:postgres@127.0.0.1:$pg_port/postgres"
database_url="postgres://postgres:postgres@127.0.0.1:$pg_port/$database"
bin_dir="$(mktemp -d)"
pids=()

cleanup() {
  trap - EXIT INT TERM
  if ((${#pids[@]})); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
  psql "$admin_url" -c "drop database if exists $database with (force)" >/dev/null
  rm -rf "$bin_dir"
}
trap cleanup EXIT INT TERM

(
  cd "$root/backend"
  go build -o "$bin_dir/dash" .
  go build -o "$bin_dir/devidp" ./cmd/devidp
)

psql "$admin_url" -v ON_ERROR_STOP=1 -c "drop database if exists $database with (force)" >/dev/null
psql "$admin_url" -v ON_ERROR_STOP=1 -c "create database $database" >/dev/null

DEVIDP_ADDR="127.0.0.1:$idp_port" \
DEVIDP_ISSUER="http://127.0.0.1:$idp_port" \
"$bin_dir/devidp" &
idp_pid=$!
pids+=("$idp_pid")

for _ in {1..100}; do
  if (echo >/dev/tcp/127.0.0.1/"$idp_port") 2>/dev/null; then
    break
  fi
  if ! kill -0 "$idp_pid" 2>/dev/null; then
    exit 1
  fi
  sleep 0.1
done

PORT="$backend_port" \
BACKEND_URL="http://127.0.0.1:$backend_port" \
FRONT_URL= \
DEV_VITE_URL= \
DB_URL="$database_url" \
IMPORT_STORE=postgres \
DISABLE_RATE_SYNC=1 \
OIDC_ISSUER="http://127.0.0.1:$idp_port" \
OIDC_CLIENT_ID=dash \
OIDC_CLIENT_SECRET=dash \
OIDC_REDIRECT_URL= \
IS_PROD=0 \
"$bin_dir/dash" &
backend_pid=$!
pids+=("$backend_pid")

wait "$backend_pid"
