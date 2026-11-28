#!/usr/bin/env bash
# Run the staging copy of the stack (see docker-compose.staging.yml). Uses .env.staging, never .env.
#   scripts/staging.sh up | down | ps | logs <service>
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.staging ] || { echo "Create .env.staging first (copy .env.example; use Stripe test keys and a test bot)"; exit 1; }
dc() { docker compose --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml "$@"; }
case "${1:-}" in
  up) dc pull --quiet && dc up -d --remove-orphans --wait && dc ps ;;
  down) dc stop ;;
  ps) dc ps ;;
  logs) dc logs --tail 200 "${2:?service}" ;;
  *) echo "usage: scripts/staging.sh up|down|ps|logs <service>"; exit 1 ;;
esac
