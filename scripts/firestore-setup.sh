#!/usr/bin/env bash
#
# One-time Firestore setup for the realtime event bus (replaces the Mercure hub).
#
# Creates the database, enables the TTL policy that reaps expired events, and
# deploys the security rules. Safe to re-run: every step is idempotent.
#
# Usage: bash scripts/firestore-setup.sh
#
# Prerequisites: gcloud CLI authenticated with rights on the project.

set -euo pipefail

cd "$(dirname "$0")/.."

GCP_PROJECT="${GCP_PROJECT:-pijama-films}"
GCP_REGION="${GCP_REGION:-us-west1}"

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

echo "==> Done."
