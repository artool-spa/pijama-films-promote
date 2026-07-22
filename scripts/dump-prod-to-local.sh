#!/usr/bin/env bash
set -euo pipefail

# Dumps the production database (GCP Cloud SQL) and restores it into the local
# development database.
#
# Production now lives on Cloud SQL and is only reachable through the Cloud SQL
# Auth Proxy, so this script starts the proxy, dumps through it, and tears it
# down again. It reads GCP_DATABASE_URL (source) and DEV_DATABASE_URL (target)
# from .env.
#
# Requirements on the host: pg_dump/psql, plus the gcloud SDK (which bundles
# cloud-sql-proxy). Authenticate once with `gcloud auth login` beforehand.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

# Local proxy port; override with PROXY_PORT if 6543 is taken.
PROXY_PORT="${PROXY_PORT:-6543}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env file not found at $ENV_FILE"
  exit 1
fi

# Read URLs from .env
DEV_DATABASE_URL=$(grep -E '^DEV_DATABASE_URL=' "$ENV_FILE" | sed 's/^DEV_DATABASE_URL=//' | tr -d '"')
GCP_DATABASE_URL=$(grep -E '^GCP_DATABASE_URL=' "$ENV_FILE" | sed 's/^GCP_DATABASE_URL=//' | tr -d '"')

if [[ -z "$DEV_DATABASE_URL" ]]; then
  echo "Error: DEV_DATABASE_URL not found in .env"
  exit 1
fi

if [[ -z "$GCP_DATABASE_URL" ]]; then
  echo "Error: GCP_DATABASE_URL not found in .env"
  exit 1
fi

# Parse a standard host:port PostgreSQL URL into components:
#   postgres[ql]://user:password@host:port/dbname[?params]
parse_pg_url() {
  local url="$1"
  local stripped="${url#*://}"
  local userpass="${stripped%%@*}"
  local hostportdb="${stripped#*@}"

  PG_USER="${userpass%%:*}"
  PG_PASS="${userpass#*:}"
  PG_HOST="${hostportdb%%:*}"

  local portdb="${hostportdb#*:}"
  PG_PORT="${portdb%%/*}"
  PG_DB="${portdb#*/}"
  PG_DB="${PG_DB%%\?*}"
}

# Parse a Cloud SQL socket URL into components:
#   postgres[ql]://user:password@/dbname?host=/cloudsql/<connection-name>
parse_cloudsql_url() {
  local url="$1"
  local stripped="${url#*://}"
  local userpass="${stripped%%@*}"
  local rest="${stripped#*@}"

  PG_USER="${userpass%%:*}"
  PG_PASS="${userpass#*:}"

  local dbpart="${rest#/}"        # strip leading slash before dbname
  PG_DB="${dbpart%%\?*}"          # dbname is everything before '?'

  # Extract the instance connection name from host=/cloudsql/<connection>
  local query="${rest#*\?}"
  local host_param="${query#*host=}"
  host_param="${host_param%%&*}"
  PG_CONNECTION="${host_param#/cloudsql/}"
}

# Validate dev target is localhost
parse_pg_url "$DEV_DATABASE_URL"
DEV_HOST="$PG_HOST"
DEV_PORT="$PG_PORT"
DEV_USER="$PG_USER"
DEV_PASS="$PG_PASS"
DEV_DB="$PG_DB"

if [[ "$DEV_HOST" != "localhost" && "$DEV_HOST" != "127.0.0.1" ]]; then
  echo "Error: DEV_DATABASE_URL host is '$DEV_HOST', expected 'localhost' or '127.0.0.1'"
  echo "Aborting to prevent accidental overwrite of a remote database."
  exit 1
fi

# Parse prod (Cloud SQL) source
parse_cloudsql_url "$GCP_DATABASE_URL"
PROD_USER="$PG_USER"
PROD_PASS="$PG_PASS"
PROD_DB="$PG_DB"
PROD_CONNECTION="$PG_CONNECTION"

if [[ -z "$PROD_CONNECTION" ]]; then
  echo "Error: could not parse the Cloud SQL connection name from GCP_DATABASE_URL"
  echo "Expected a '?host=/cloudsql/<project:region:instance>' parameter."
  exit 1
fi

# Locate gcloud + cloud-sql-proxy (prefer PATH, fall back to the SDK install dir)
GCLOUD_SDK_DIR="${GCLOUD_SDK_DIR:-$HOME/google-cloud-sdk}"
GCLOUD_BIN="$(command -v gcloud || echo "$GCLOUD_SDK_DIR/bin/gcloud")"
PROXY_BIN="$(command -v cloud-sql-proxy || echo "$GCLOUD_SDK_DIR/bin/cloud-sql-proxy")"

if [[ ! -x "$GCLOUD_BIN" ]]; then
  echo "Error: gcloud not found. Install the Google Cloud SDK or set GCLOUD_SDK_DIR."
  exit 1
fi
if [[ ! -x "$PROXY_BIN" ]]; then
  echo "Error: cloud-sql-proxy not found. Install it with: gcloud components install cloud-sql-proxy"
  exit 1
fi

# Obtain a short-lived access token so the proxy authenticates without ADC.
ACCESS_TOKEN="$("$GCLOUD_BIN" auth print-access-token 2>/dev/null || true)"
if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Error: could not obtain a gcloud access token. Run 'gcloud auth login' first."
  exit 1
fi

DUMP_FILE="$(mktemp -t pijama_films_prod_dump.XXXXXX.sql)"
PROXY_PID=""

cleanup() {
  [[ -n "$PROXY_PID" ]] && kill "$PROXY_PID" 2>/dev/null || true
  rm -f "$DUMP_FILE"
}
trap cleanup EXIT

echo "==> Starting Cloud SQL Auth Proxy for $PROD_CONNECTION on 127.0.0.1:$PROXY_PORT..."
"$PROXY_BIN" --token "$ACCESS_TOKEN" --port "$PROXY_PORT" "$PROD_CONNECTION" >/dev/null 2>&1 &
PROXY_PID=$!

# Wait for the proxy to accept connections (up to ~30s)
for _ in $(seq 1 30); do
  if PGPASSWORD="$PROD_PASS" pg_isready -h 127.0.0.1 -p "$PROXY_PORT" -U "$PROD_USER" -d "$PROD_DB" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "Error: Cloud SQL proxy exited before becoming ready."
    exit 1
  fi
  sleep 1
done

if ! PGPASSWORD="$PROD_PASS" pg_isready -h 127.0.0.1 -p "$PROXY_PORT" -U "$PROD_USER" -d "$PROD_DB" >/dev/null 2>&1; then
  echo "Error: Cloud SQL proxy did not become ready in time."
  exit 1
fi

echo "==> Dumping production database ($PROD_CONNECTION/$PROD_DB)..."
# The host pg_dump may be newer than the PG16 server/target and emit SETs the
# older engine rejects (e.g. transaction_timeout, added in PG17). Strip those
# session-config lines; they are cosmetic and harmless to the restore.
PGPASSWORD="$PROD_PASS" pg_dump \
  -h 127.0.0.1 \
  -p "$PROXY_PORT" \
  -U "$PROD_USER" \
  -d "$PROD_DB" \
  --clean --if-exists \
  --no-owner --no-privileges \
  | sed '/^SET transaction_timeout/d' \
  > "$DUMP_FILE"

echo "==> Restoring to local database ($DEV_HOST:$DEV_PORT/$DEV_DB)..."
PGPASSWORD="$DEV_PASS" psql \
  -h "$DEV_HOST" \
  -p "$DEV_PORT" \
  -U "$DEV_USER" \
  -d "$DEV_DB" \
  --quiet \
  < "$DUMP_FILE"

echo "==> Done. Production database dumped to local successfully."
