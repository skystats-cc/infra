#!/usr/bin/env bash
# Laptop checks for a home server: battery, temperature, disk, memory, SMART. Alerts the ops channel.
# Cron (every 10 minutes):  */10 * * * *  /home/<you>/skystats/infra/scripts/laptop-health.sh >> /home/<you>/skystats/infra/backups/health.log 2>&1
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

disk_max=$(env_get HEALTH_DISK_MAX_PERCENT 85)
temp_max=$(env_get HEALTH_TEMP_MAX_C 85)
mem_min_mb=$(env_get HEALTH_MEM_MIN_MB 400)
problems=()

# Disk (the Docker data root and this repo)
for path in / "$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"; do
  [ -d "$path" ] || continue
  used=$(df -P "$path" | awk 'NR==2 {gsub("%",""); print $5}')
  [ "$used" -ge "$disk_max" ] && problems+=("disk $path at ${used}%")
done

# Memory available
avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
[ "$avail" -lt "$mem_min_mb" ] && problems+=("only ${avail} MB memory available")

# Hottest thermal zone
hot=0
for z in /sys/class/thermal/thermal_zone*/temp; do
  [ -r "$z" ] || continue
  t=$(( $(cat "$z") / 1000 ))
  [ "$t" -gt "$hot" ] && hot=$t
done
[ "$hot" -ge "$temp_max" ] && problems+=("CPU at ${hot}°C")

# Battery: unplugged or worn out
for b in /sys/class/power_supply/BAT*; do
  [ -d "$b" ] || continue
  status=$(cat "$b/status" 2>/dev/null || echo Unknown)
  cap=$(cat "$b/capacity" 2>/dev/null || echo 100)
  [ "$status" = "Discharging" ] && problems+=("on battery (${cap}%) - is the charger unplugged or the power out?")
  if [ -r "$b/energy_full" ] && [ -r "$b/energy_full_design" ]; then
    wear=$(( 100 * $(cat "$b/energy_full") / $(cat "$b/energy_full_design") ))
    [ "$wear" -lt 60 ] && problems+=("battery holds only ${wear}% of its design charge; replace it soon")
  fi
done

# SMART (needs smartmontools and sudo rights for smartctl)
if command -v smartctl >/dev/null; then
  for dev in $(lsblk -dno NAME,TYPE | awk '$2=="disk" {print "/dev/"$1}'); do
    if ! sudo -n smartctl -H "$dev" 2>/dev/null | grep -qE 'PASSED|OK'; then
      sudo -n true 2>/dev/null && problems+=("SMART health check failed on $dev")
    fi
  done
fi

# Containers that should be running but aren't healthy
unhealthy=$(docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk '$2=="unhealthy" {print $1}' | xargs)
[ -n "$unhealthy" ] && problems+=("unhealthy: $unhealthy")

if [ ${#problems[@]} -eq 0 ]; then
  log "Laptop healthy"
  rm -f .health-alerted
  exit 0
fi
msg="Laptop health: $(IFS='; '; echo "${problems[*]}")"
log "$msg"
# One alert per distinct problem set, not one every 10 minutes
digest=$(printf '%s' "$msg" | sha256sum | cut -c1-16)
if [ "$(cat .health-alerted 2>/dev/null)" != "$digest" ]; then
  scripts/notify.sh "$msg"
  printf '%s' "$digest" > .health-alerted
fi
