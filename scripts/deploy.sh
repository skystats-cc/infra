#!/usr/bin/env bash
# Pull the latest images and restart whatever changed. Safe to run any time.
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

log "Updating infra repo"
git pull --ff-only

log "Pulling images"
docker compose pull --quiet

log "Starting stack (migrations run first)"
docker compose up -d --remove-orphans --wait

log "Cleaning up old images"
docker image prune -f >/dev/null

docker compose ps --format 'table {{.Service}}\t{{.Status}}'
log "Deployed. If bot commands changed, run scripts/register-commands.sh"
