#!/usr/bin/env bash
# Run WITHOUT Docker, using your own PostgreSQL and Node.js 20+ (macOS / Linux)
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js 20 or newer is required: https://nodejs.org"; exit 1; }
if [ ! -f .env ]; then cp .env.example .env; echo "Created .env. Set DATABASE_URL to your PostgreSQL database, then run ./run-local.sh again."; exit 0; fi
set -a; . ./.env; set +a
npm ci --include=dev --no-audit --no-fund
npm run build
npm run start:prod
