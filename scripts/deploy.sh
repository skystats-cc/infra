#!/usr/bin/env bash
# Pull the latest images and restart whatever changed, with health checks and automatic rollback.
#   scripts/deploy.sh            deploy
#   scripts/deploy.sh --rollback go back to the images from before the last deploy
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

APP_SERVICES=(api worker web bot)
STATE=.deploy-previous   # image ids from before the last deploy (git-ignored)

health_ok() {
  for _ in $(seq 1 30); do
    if curl -fsS -m 3 http://127.0.0.1:3000/readyz >/dev/null && curl -fsS -m 3 -o /dev/null http://127.0.0.1:8080/; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# Tag each running app image as <repo>:rollback so pulling a new :main can't lose it.
# The repo comes from the running container itself ("docker compose config --images" ignores
# the service name and lists every image, which once tagged the web image as server:rollback).
remember_current() {
  : > "$STATE"
  local svc cid id ref repo
  for svc in "${APP_SERVICES[@]}"; do
    cid=$(docker compose ps -q "$svc" 2>/dev/null | head -n1 || true)
    [ -n "$cid" ] || continue
    id=$(docker inspect --format '{{.Image}}' "$cid")
    ref=$(docker inspect --format '{{.Config.Image}}' "$cid")
    repo=${ref%:*}
    case "$repo" in ghcr.io/skystats-cc/*) ;; *) continue ;; esac
    docker tag "$id" "$repo:rollback"
    printf '%s %s\n' "$svc" "$repo" >> "$STATE"
  done
}

rollback() {
  [ -s "$STATE" ] || die "Nothing to roll back to ($STATE is empty)"
  log "Rolling back to the previous images"
  local overrides=()
  local services=()
  while read -r svc repo; do
    # Only roll back what was actually saved; anything else keeps its current tag
    docker image inspect "$repo:rollback" >/dev/null 2>&1 || continue
    services+=("$svc")
    case "$repo" in
      */server) overrides+=("SERVER_TAG=rollback") ;;
      */web) overrides+=("WEB_TAG=rollback") ;;
      */discord-bot) overrides+=("BOT_TAG=rollback") ;;
    esac
  done < "$STATE"
  [ ${#services[@]} -gt 0 ] || die "No saved :rollback images found"
  # Migrations are forward-only: the old server must tolerate the new schema (we only add columns/tables)
  env "${overrides[@]}" docker compose up -d --no-deps --pull never --wait "${services[@]}"
  if health_ok; then
    log "Rolled back. Previous images are running (tag :rollback)."
    scripts/notify.sh "Deploy rolled back; the previous version is running. Check logs before retrying."
  else
    scripts/notify.sh "Deploy rollback ALSO failed health checks. Needs a person now."
    die "Rollback failed health checks too"
  fi
}

if [ "${1:-}" = "--rollback" ]; then rollback; exit 0; fi

log "Updating infra repo"
git pull --ff-only

if [ -d mcp ] && command -v npm >/dev/null; then
  log "Rebuilding the skystats-ops MCP server"
  (cd mcp && npm ci --silent --no-audit --no-fund && npm run build --silent)
fi

log "Remembering the running versions"
remember_current

log "Pulling images"
docker compose pull --quiet

log "Starting stack (migrations run first)"
if ! docker compose up -d --remove-orphans --wait || ! health_ok; then
  log "Health check failed after deploy"
  # Show why, e.g. a failed migration (wrong database password, bad migration)
  if [ "$(docker compose ps -a --format '{{.ExitCode}}' migrate 2>/dev/null | head -n1)" != "0" ]; then
    log "The migrate step failed. Its last lines:"
    docker compose logs --no-log-prefix --tail 15 migrate || true
  fi
  rollback
  exit 1
fi

# Only now is it safe to drop old images (the :rollback tags keep the previous version)
log "Cleaning up dangling images"
docker image prune -f >/dev/null

docker compose ps --format 'table {{.Service}}\t{{.Status}}'
scripts/notify.sh "Deployed $(git rev-parse --short HEAD) - all health checks passed"
log "Deployed. If bot commands changed, run scripts/register-commands.sh"
