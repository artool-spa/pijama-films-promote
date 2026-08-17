#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Enabling Yarn 1.22.22 via corepack"
corepack enable
corepack prepare yarn@1.22.22 --activate

echo "==> Installing dependencies"
yarn install --frozen-lockfile

echo "==> Starting docker compose services (db)"
docker compose up -d

echo "==> Waiting for PostgreSQL to accept connections"
until docker compose exec -T db pg_isready -U pijama -d pijama_films >/dev/null 2>&1; do
  sleep 1
done
echo "    PostgreSQL is ready."

echo "==> Generating Prisma client"
npx prisma generate

echo "==> Applying Prisma migrations"
npx prisma migrate deploy

echo "==> Seeding database"
yarn db:seed

echo "==> Materializing .env.local for Codespaces URLs"
bash .devcontainer/post-start.sh

echo "==> Done. Run 'yarn dev' to start the app."
