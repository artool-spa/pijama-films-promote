#!/usr/bin/env bash
#
# Firestore setup: database, TTL policy, security rules and composite indexes.
#
# Safe to re-run: every step is idempotent.
#
# Usage: FIREBASE_PROJECT_ID=<project> bash scripts/firestore-setup.sh
#
# The project MUST be passed explicitly. This script used to fall back to a
# hardcoded `pijama-films` when the variable was absent, and that default was a
# trap: this is a bash script, so it does NOT read `.env`, and in an ordinary
# shell the variable is simply not set. Running the documented command therefore
# deployed THIS project's security rules to `pijama-films` — a different project
# that is still active — and would have tried to create a database there.
# Guessing a project is never better than refusing to run.
#
# Prerequisites: gcloud CLI authenticated with rights on the project.

set -euo pipefail

cd "$(dirname "$0")/.."

GCP_PROJECT="${FIREBASE_PROJECT_ID:-${GCP_PROJECT:-}}"
GCP_REGION="${GCP_REGION:-us-west1}"

if [[ -z "${GCP_PROJECT}" ]]; then
  cat >&2 <<'USAGE'
error: no project given.

Set FIREBASE_PROJECT_ID (or GCP_PROJECT) explicitly — this script deploys
security rules and creates a database, so it will not guess which project
to touch.

  FIREBASE_PROJECT_ID=pijama-promote-firebase bash scripts/firestore-setup.sh

Note that this script does not read .env; export the variable in the shell.
USAGE
  exit 1
fi

echo "==> Project: ${GCP_PROJECT} (${GCP_REGION})"

echo "==> Enabling Firestore API"
gcloud services enable firestore.googleapis.com --project="${GCP_PROJECT}"

echo "==> Ensuring Firestore database exists"
if gcloud firestore databases describe --project="${GCP_PROJECT}" >/dev/null 2>&1; then
  echo "    already exists, skipping"
else
  gcloud firestore databases create \
    --location="${GCP_REGION}" \
    --type=firestore-native \
    --project="${GCP_PROJECT}"
fi

# Events carry an `expiresAt` field; this policy deletes them automatically so
# the collection never needs a cleanup cron.
echo "==> Enabling TTL policy on events.expiresAt"
gcloud firestore fields ttls update expiresAt \
  --collection-group=events \
  --enable-ttl \
  --project="${GCP_PROJECT}" \
  --quiet

echo "==> Deploying security rules"
npx firebase-tools deploy --only firestore:rules --project="${GCP_PROJECT}"

# Indexes were missing here until 2026-09-16, while CLAUDE.md claimed this
# script deployed them. A composite index added to firestore.indexes.json
# therefore never reached the project, and the query that needed it failed in
# production with a missing-index error pointing at the code rather than at the
# gap between the command and its description.
#
# No `--force`: without it, firebase-tools reports indexes and field overrides
# that exist in the project but not in the file, and leaves them alone. That
# matters here — the TTL policy set above IS such a field override, and --force
# would delete it, silently stopping event expiry.
echo "==> Deploying composite indexes"
npx firebase-tools deploy --only firestore:indexes --project="${GCP_PROJECT}"

echo "==> Done."
