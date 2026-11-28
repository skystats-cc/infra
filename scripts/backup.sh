#!/usr/bin/env bash
# Dump the database to backups/, prune old dumps, optionally copy off-site.
# Cron (daily at 04:15):  15 4 * * *  /home/<you>/skystats/infra/scripts/backup.sh >> /home/<you>/skystats/infra/backups/backup.log 2>&1
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

user=$(env_get POSTGRES_USER skystats)
db=$(env_get POSTGRES_DB skystats)
keep=$(env_get BACKUP_KEEP_DAYS 14)
remote=$(env_get RCLONE_REMOTE)
recipient=$(env_get BACKUP_AGE_RECIPIENT)
remote_keep=$(env_get BACKUP_REMOTE_KEEP_DAYS 30)

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
  # Personal data never leaves the laptop unencrypted
  [ -n "$recipient" ] || die "RCLONE_REMOTE is set but BACKUP_AGE_RECIPIENT is empty; refusing an unencrypted off-site copy"
  command -v age >/dev/null || die "age is not installed (sudo apt install age)"
  log "Encrypting for off-site copy"
  age -r "$recipient" -o "$file.age" "$file"
  log "Copying to $remote"
  rclone copy "$file.age" "$remote"
  rm -f "$file.age"
  log "Removing off-site copies older than $remote_keep days"
  rclone delete --min-age "${remote_keep}d" "$remote"
fi
log "Backup done"
