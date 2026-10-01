#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Realtime events go through Firestore over HTTPS, so no forwarded-port
# rewriting is needed here any more (Mercure used to require it).
