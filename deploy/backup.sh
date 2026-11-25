#!/usr/bin/env bash
# Database backup to ./backups (compressed SQL), keeping the last 14 days.  Restore: see DEPLOY.md
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
f="backups/skillprint-$(date +%Y%m%d-%H%M).sql.gz"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U rsip rsip | gzip > "$f"
find backups -name 'skillprint-*.sql.gz' -mtime +14 -delete
echo "Backup written: $f"
