#!/usr/bin/env bash
# Install a new version: copy the new files over this folder (keep .env, data, models, backups), then run:  sudo bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash deploy/backup.sh
docker compose -f docker-compose.prod.yml up -d --build
echo "Updated. The database is migrated automatically on start; your data is kept."
