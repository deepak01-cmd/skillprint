#!/usr/bin/env bash
cd "$(dirname "$0")" && docker compose stop && echo "Stopped. Your data is kept. Run ./run.sh to start again."
