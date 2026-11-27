#!/usr/bin/env bash
# Dump the database to backups/, prune old dumps, optionally copy off-site.
# Cron (daily at 04:15):  15 4 * * *  /home/<you>/skystats/infra/scripts/backup.sh >> /home/<you>/skystats/infra/backups/backup.log 2>&1
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

user=$(env_get POSTGRES_USER skystats)
db=$(env_get POSTGRES_DB skystats)
keep=$(env_get BACKUP_KEEP_DAYS 14)
remote=$(env_get RCLONE_REMOTE)

mkdir -p backups
file="backups/${db}-$(date +%Y%m%d-%H%M%S).dump"

log "Dumping $db -> $file"
docker compose exec -T postgres pg_dump -U "$user" -d "$db" --format=custom --compress=6 > "$file.partial"
mv "$file.partial" "$file"
log "Size: $(du -h "$file" | cut -f1)"

log "Removing dumps older than $keep days"
find backups -name '*.dump' -mtime "+$keep" -print -delete

if [ -n "$remote" ]; then
  command -v rclone >/dev/null || die "RCLONE_REMOTE set but rclone is not installed"
  log "Copying to $remote"
  rclone copy "$file" "$remote"
fi
log "Backup done"
