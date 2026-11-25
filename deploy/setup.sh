#!/usr/bin/env bash
# One-time server setup for Skillprint on Ubuntu 22.04 / 24.04. Run from the app folder:  sudo bash deploy/setup.sh
# Installs Docker, opens the firewall for web traffic, writes .env with strong random secrets, starts everything,
# and gives the demo accounts a private password (printed at the end and saved in deploy/demo-password.txt).
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo bash deploy/setup.sh"; exit 1; }
[ -f docker-compose.prod.yml ] || { echo "Run this from the Skillprint folder (docker-compose.prod.yml not found)."; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi
if command -v ufw >/dev/null 2>&1; then ufw allow OpenSSH >/dev/null || true; ufw allow 80/tcp >/dev/null || true; ufw allow 443/tcp >/dev/null || true; fi
mkdir -p data models backups

if [ ! -f .env ]; then
  ip=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  suggestion="$(echo "$ip" | tr '.' '-').sslip.io"
  echo ""
  echo "Web address for the app. Use your own domain (point its DNS A record to $ip first),"
  echo "or press Enter to use the free address $suggestion (works straight away)."
  read -r -p "Domain [$suggestion]: " domain; domain=${domain:-$suggestion}
  cat > .env <<ENV
# Created by deploy/setup.sh. Keep this file private.
DOMAIN=$domain
DB_PASSWORD=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -hex 48)
DEMO_MODE=true
SHOW_DEMO_LOGINS=false
IMPORT_JOBS=true
AI_PROVIDER=auto
AI_TIMEOUT_MS=600000
MAX_UPLOAD_MB=120
ENV
  chmod 600 .env
fi
domain=$(grep '^DOMAIN=' .env | cut -d= -f2)

echo "Building and starting (the first time takes about 5-10 minutes)..."
docker compose -f docker-compose.prod.yml up -d --build

echo "Waiting for the app to finish loading its data..."
for i in $(seq 1 120); do
  if docker compose -f docker-compose.prod.yml exec -T app node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then ready=1; break; fi
  sleep 10
done
[ "${ready:-}" = 1 ] || { echo "The app is not up yet. See: docker compose -f docker-compose.prod.yml logs app"; exit 1; }

if [ ! -f deploy/demo-password.txt ]; then
  pw=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)
  docker compose -f docker-compose.prod.yml exec -T app npm run -s demo:password -- "$pw"
  echo "$pw" > deploy/demo-password.txt; chmod 600 deploy/demo-password.txt
fi

# daily database backup at 02:30, kept for 14 days
cron="30 2 * * * root cd $(pwd) && bash deploy/backup.sh >> backups/backup.log 2>&1"
echo "$cron" > /etc/cron.d/skillprint-backup

echo ""
echo "Skillprint is running at: https://$domain"
echo "Demo accounts (for example hr@finedge.demo) now use the password: $(cat deploy/demo-password.txt)"
echo "Share the address and a login only with your testers. Daily backups go to ./backups."
