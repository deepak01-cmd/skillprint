#!/usr/bin/env bash
cd "$(dirname "$0")"
read -r -p "This deletes ALL data and reloads the sample on next start. Type YES to continue: " ok
[ "$ok" = "YES" ] && docker compose down -v && echo "Data removed. Run ./run.sh to start fresh."
