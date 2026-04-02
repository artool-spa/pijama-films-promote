#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env file not found at $ENV_FILE"
  exit 1
fi

# Read URLs from .env
DEV_DATABASE_URL=$(grep -E '^DEV_DATABASE_URL=' "$ENV_FILE" | sed 's/^DEV_DATABASE_URL=//' | tr -d '"')
PROD_DATABASE_URL=$(grep -E '^PROD_DATABASE_URL=' "$ENV_FILE" | sed 's/^PROD_DATABASE_URL=//' | tr -d '"')

if [[ -z "$DEV_DATABASE_URL" ]]; then
  echo "Error: DEV_DATABASE_URL not found in .env"
  exit 1
fi

if [[ -z "$PROD_DATABASE_URL" ]]; then
  echo "Error: PROD_DATABASE_URL not found in .env"
  exit 1
fi

# Parse a PostgreSQL URL into components
# Format: postgres[ql]://user:password@host:port/dbname[?params]
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

# Validate dev host is localhost
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

# Parse prod URL
parse_pg_url "$PROD_DATABASE_URL"
PROD_HOST="$PG_HOST"
PROD_PORT="$PG_PORT"
PROD_USER="$PG_USER"
PROD_PASS="$PG_PASS"
PROD_DB="$PG_DB"

DOCKER_COMPOSE_FILE="$SCRIPT_DIR/../docker-compose.yml"
DOCKER_SERVICE="db"

# Verify the db container is running
if ! docker compose -f "$DOCKER_COMPOSE_FILE" ps --status running "$DOCKER_SERVICE" 2>/dev/null | grep -q "$DOCKER_SERVICE"; then
  echo "Error: Docker service '$DOCKER_SERVICE' is not running. Start it with: docker compose up -d"
  exit 1
fi

echo "==> Dumping production database ($PROD_HOST:$PROD_PORT/$PROD_DB)..."
docker compose -f "$DOCKER_COMPOSE_FILE" exec -T "$DOCKER_SERVICE" \
  env PGPASSWORD="$PROD_PASS" pg_dump \
  -h "$PROD_HOST" \
  -p "$PROD_PORT" \
  -U "$PROD_USER" \
  -d "$PROD_DB" \
  --clean --if-exists \
  --no-owner --no-privileges \
  > /tmp/pijama_films_prod_dump.sql

echo "==> Restoring to local database ($DEV_DB)..."
docker compose -f "$DOCKER_COMPOSE_FILE" exec -T "$DOCKER_SERVICE" \
  env PGPASSWORD="$DEV_PASS" psql \
  -U "$DEV_USER" \
  -d "$DEV_DB" \
  --quiet \
  < /tmp/pijama_films_prod_dump.sql

rm -f /tmp/pijama_films_prod_dump.sql

echo "==> Done. Production database dumped to local successfully."
