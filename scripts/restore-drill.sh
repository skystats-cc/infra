#!/usr/bin/env bash
# Monthly restore drill: proves the newest backup actually restores. It restores into a throwaway
# Postgres container on a temporary volume. It never touches the live database or its volume.
# Cron (first Sunday, 05:00):  0 5 1-7 * 0  /home/<you>/skystats/infra/scripts/restore-drill.sh >> /home/<you>/skystats/infra/backups/drill.log 2>&1
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

file=$(find backups -maxdepth 1 -name '*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2- || true)
[ -n "$file" ] || die "No backups found in backups/"
name="skystats-restore-drill-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

log "Starting a throwaway Postgres ($name)"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do docker exec "$name" pg_isready -U postgres -d drill >/dev/null 2>&1 && break; sleep 1; done

log "Restoring $file"
start=$(date +%s)
docker exec -i "$name" pg_restore -U postgres -d drill --no-owner --exit-on-error < "$file"
took=$(( $(date +%s) - start ))

q() { docker exec "$name" psql -U postgres -d drill -Atc "$1"; }
accounts=$(q "select count(*) from accounts")
snapshots=$(q "select count(*) from member_snapshots")
newest=$(q "select coalesce(max(taken_at)::text, 'none') from member_snapshots")
migrations=$(q "select count(*) from drizzle.__drizzle_migrations" 2>/dev/null || echo "?")

summary="Restore drill OK: $(basename "$file") restored in ${took}s; ${accounts} accounts, ${snapshots} snapshots (newest ${newest}), ${migrations} migrations"
log "$summary"
scripts/notify.sh "$summary"
