#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Enabling Yarn 1.22.22 via corepack"
corepack enable
corepack prepare yarn@1.22.22 --activate

echo "==> Installing dependencies"
yarn install --frozen-lockfile

echo "==> Materializing .env.local for Codespaces URLs"
bash .devcontainer/post-start.sh

echo "==> Done. Run 'yarn dev' to start the app."
