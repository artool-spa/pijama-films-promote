#!/usr/bin/env bash
#
# Export every table of the legacy Postgres database to JSON.
#
# This is the only step that touches the production database, and it is
# deliberately separate from the import: `scripts/firestore-import.ts` needs no
# database access at all, so the credential's blast radius ends here.
#
# Security properties, in the order they matter:
#
#   * Connection goes through the Cloud SQL Auth Proxy, authenticated with your
#     own ADC. The instance keeps no authorized network, nothing is exposed to
#     the internet, and the hop is encrypted.
#   * The password is read from a file and handed to psql through PGPASSFILE.
#     It never appears in argv (which is world-readable via /proc), in the
#     environment, or in your shell history.
#   * The session is read-only: PGOPTIONS pins default_transaction_read_only,
#     so even a typo in a query cannot write to production.
#   * Output files are created under a umask of 077. They contain production
#     data — delete them once the import is verified.
#
# Usage:
#   scripts/postgres-export.sh <output-dir>
#
#   PG_USER            database role            (default: claude_readonly)
#   PG_PASSWORD_FILE   file holding its password (required, mode 600)
#   PG_DATABASE        database name            (default: pijama_films)
#   INSTANCE           Cloud SQL connection name
#                      (default: pijama-films:us-west1:pijama-db)
#
# Requires: cloud-sql-proxy, psql, and `gcloud auth application-default login`.

set -euo pipefail
umask 077

OUT_DIR="${1:-}"
PG_USER="${PG_USER:-claude_readonly}"
PG_DATABASE="${PG_DATABASE:-pijama_films}"
INSTANCE="${INSTANCE:-pijama-films:us-west1:pijama-db}"
PORT="${PORT:-5433}"

if [[ -z "$OUT_DIR" ]]; then
  echo "Usage: scripts/postgres-export.sh <output-dir>" >&2
  exit 1
fi

if [[ -z "${PG_PASSWORD_FILE:-}" ]]; then
  echo "PG_PASSWORD_FILE is not set (path to a file holding the ${PG_USER} password)" >&2
  exit 1
fi

if [[ ! -r "$PG_PASSWORD_FILE" ]]; then
  echo "Cannot read PG_PASSWORD_FILE: $PG_PASSWORD_FILE" >&2
  exit 1
fi

PROXY_BIN="$(command -v cloud-sql-proxy || echo "$HOME/google-cloud-sdk/bin/cloud-sql-proxy")"

if [[ ! -x "$PROXY_BIN" ]]; then
  echo "cloud-sql-proxy not found" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

WORK_DIR="$(mktemp -d)"
PGPASSFILE="$WORK_DIR/pgpass"
PROXY_LOG="$WORK_DIR/proxy.log"
PROXY_PID=""

cleanup() {
  [[ -n "$PROXY_PID" ]] && kill "$PROXY_PID" 2>/dev/null || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# host:port:database:user:password — psql reads this only if it is mode 600.
printf '127.0.0.1:%s:%s:%s:%s\n' \
  "$PORT" "$PG_DATABASE" "$PG_USER" "$(cat "$PG_PASSWORD_FILE")" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"

echo "Starting the Cloud SQL Auth Proxy for $INSTANCE on 127.0.0.1:$PORT"
"$PROXY_BIN" --address 127.0.0.1 --port "$PORT" "$INSTANCE" > "$PROXY_LOG" 2>&1 &
PROXY_PID=$!

for _ in $(seq 1 30); do
  if grep -q "ready for new connections" "$PROXY_LOG" 2>/dev/null; then break; fi
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "The proxy exited before accepting connections:" >&2
    cat "$PROXY_LOG" >&2
    exit 1
  fi
  sleep 1
done

export PGPASSFILE
export PGOPTIONS="-c default_transaction_read_only=on"

psql_json() {
  local table="$1" out="$2"
  # -A -t: unaligned, no header, no row count — the file is the JSON value and
  # nothing else. coalesce keeps an empty table from producing a bare "null".
  psql -h 127.0.0.1 -p "$PORT" -U "$PG_USER" -d "$PG_DATABASE" -At \
    -c "select coalesce(json_agg(row_to_json(t)), '[]'::json) from \"$table\" t" \
    > "$OUT_DIR/$out"
  echo "  $table -> $out ($(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$OUT_DIR/$out','utf8')).length))") rows)"
}

echo "Exporting to $OUT_DIR"
psql_json UserPreference     userPreferences.json
psql_json Partner            partners.json
psql_json Campaign           campaigns.json
psql_json Ad                 ads.json
psql_json Image              images.json
psql_json Video              videos.json
psql_json GeneratedCopy      generatedCopies.json
psql_json Account            accounts.json
psql_json AccountTransaction transactions.json
psql_json _AdImages          adImages.json
psql_json _AdVideos          adVideos.json

echo
echo "Done. These files hold production data — delete them once the import is verified."
