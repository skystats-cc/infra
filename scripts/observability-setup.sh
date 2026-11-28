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
if [ -z "$(env_get GRAFANA_ADMIN_PASSWORD)" ]; then
  printf '\nGRAFANA_ADMIN_PASSWORD=%s\n' "$(openssl rand -base64 24 | tr -d '/+=')" >> .env
  log "Added a random GRAFANA_ADMIN_PASSWORD to .env (read it with the config_get tool, it's masked; or open .env yourself)"
fi
log "Add observability to COMPOSE_PROFILES in .env"
log "Then: docker compose up -d   (Grafana: http://localhost:3002, user admin)"
