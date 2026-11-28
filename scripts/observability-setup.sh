#!/usr/bin/env bash
# One-time setup for the observability profile: writes the token Prometheus sends to /metrics.
# Reads METRICS_TOKEN from .env (or creates one) without printing it.
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

token=$(env_get METRICS_TOKEN)
if [ -z "$token" ]; then
  token=$(openssl rand -hex 32)
  printf '\nMETRICS_TOKEN=%s\n' "$token" >> .env
  log "Added a new METRICS_TOKEN to .env"
fi
mkdir -p observability/secrets
umask 077
printf '%s' "$token" > observability/secrets/metrics_token
log "Wrote observability/secrets/metrics_token (git-ignored)"
[ -n "$(env_get GRAFANA_ADMIN_PASSWORD)" ] || log "Set GRAFANA_ADMIN_PASSWORD in .env, then add observability to COMPOSE_PROFILES"
log "Then: docker compose up -d   (Grafana: http://localhost:3002, user admin)"
