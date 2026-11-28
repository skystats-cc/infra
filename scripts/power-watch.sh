#!/usr/bin/env bash
# Power-loss safety for a laptop server. On battery and below the threshold, back up and stop the
# stack cleanly so Postgres never dies mid-write when the battery runs out. Starts it again when
# the charger is back.
# Cron (every minute):  * * * * *  /home/<you>/skystats/infra/scripts/power-watch.sh >> /home/<you>/skystats/infra/backups/power.log 2>&1
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

threshold=$(env_get POWER_STOP_AT_PERCENT 25)
bat=""
for b in /sys/class/power_supply/BAT*; do [ -d "$b" ] && { bat=$b; break; }; done
[ -n "$bat" ] || exit 0
status=$(cat "$bat/status")
cap=$(cat "$bat/capacity")
marker=.power-stopped

if [ "$status" = "Discharging" ] && [ "$cap" -le "$threshold" ] && [ ! -f "$marker" ]; then
  log "On battery at ${cap}%: backing up and stopping the stack"
  scripts/notify.sh "Power: on battery at ${cap}%. Taking a backup and stopping SkyStats cleanly."
  scripts/backup.sh || log "Backup failed; stopping anyway"
  docker compose stop -t 60
  touch "$marker"
elif [ "$status" != "Discharging" ] && [ -f "$marker" ]; then
  log "Charger back (${cap}%): starting the stack"
  docker compose up -d --wait && rm -f "$marker"
  scripts/notify.sh "Power: charger back at ${cap}%. SkyStats is running again."
fi
