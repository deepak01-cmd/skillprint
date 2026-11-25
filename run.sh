#!/usr/bin/env bash
# Role & Skill Intelligence Platform - start with Docker Desktop (macOS / Linux)
set -e
cd "$(dirname "$0")"
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop, wait until the engine is running, then run ./run.sh again."; exit 1
fi
echo "Building and starting (the first run takes 3-6 minutes)..."
docker compose up -d --build
echo "Waiting for the app to finish loading the sample data..."
for i in $(seq 1 120); do
  if curl -fs http://localhost:3000/api/v1/health >/dev/null 2>&1; then
    echo; echo "Ready:  http://localhost:3000"; echo "Sign in with any demo account on the login page. Password: demo1234"; echo "To stop: ./stop.sh"
    (command -v open >/dev/null && open http://localhost:3000) || (command -v xdg-open >/dev/null && xdg-open http://localhost:3000) || true
    exit 0
  fi
  sleep 3
done
echo "The app did not answer after 6 minutes. Last log lines:"; docker compose logs --tail 80 app; exit 1
