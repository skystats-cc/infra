#!/usr/bin/env bash
# Restore a dump made by backup.sh. Replaces the current database contents!
#   scripts/restore.sh backups/skystats-20261127-041500.dump
#   Off-site copies are age-encrypted: decrypt first with  age -d -i <key.txt> file.dump.age > file.dump
#   After restoring, re-run erasures logged since the dump (audit_log action = account.erased) so deleted accounts stay deleted.
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

file="${1:-}"
[ -f "$file" ] || die "usage: scripts/restore.sh <backup.dump>"
user=$(env_get POSTGRES_USER skystats)
db=$(env_get POSTGRES_DB skystats)

read -r -p "This REPLACES the '$db' database with $file. Type the database name to continue: " answer
[ "$answer" = "$db" ] || die "aborted"

log "Stopping services that use the database"
docker compose stop api worker bot web

log "Restoring"
docker compose exec -T postgres pg_restore -U "$user" -d "$db" --clean --if-exists --no-owner < "$file"

log "Starting services"
docker compose up -d --wait
log "Restore done"
