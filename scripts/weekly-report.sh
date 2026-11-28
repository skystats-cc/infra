#!/usr/bin/env bash
# Weekly ops summary to the ops Discord channel: growth, jobs, data quality, disk, backups.
# Cron (Mondays 09:07):  7 9 * * 1  /home/<you>/skystats/infra/scripts/weekly-report.sh >> /home/<you>/skystats/infra/backups/report.log 2>&1
# Counts only; no usernames or other personal data go to Discord.
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

user=$(env_get POSTGRES_USER skystats)
db=$(env_get POSTGRES_DB skystats)
admin_key=$(env_get ADMIN_API_KEY)
q() { docker compose exec -T postgres psql -U "$user" -d "$db" -Atc "$1"; }

accounts=$(q "select count(*) from accounts")
new=$(q "select count(*) from accounts where created_at > now() - interval '7 days'")
active=$(q "select count(*) from accounts where mod_last_seen_at > now() - interval '7 days'")
paid=$(q "select tier || ': ' || count(*) from entitlements where status in ('active','trialing','gift','comp') group by tier order by tier" | paste -sd, -)
late=$(curl -fsS -m 10 -H "x-admin-key: $admin_key" http://127.0.0.1:3000/admin/jobs | jq '[.jobs[] | select(.late)] | length' 2>/dev/null || echo "?")
dq=$(curl -fsS -m 10 -H "x-admin-key: $admin_key" http://127.0.0.1:3000/admin/data-quality | jq -c . 2>/dev/null || echo "?")
disk=$(df -hP / | awk 'NR==2 {print $5 " used"}')
last_backup=$(ls -t backups/*.dump 2>/dev/null | head -n1 | xargs -r basename || echo none)

report="Weekly report: ${accounts} accounts (+${new} this week), ${active} active with the mod; paid ${paid:-none}. Late jobs: ${late}. Data quality: ${dq}. Disk ${disk}. Last backup: ${last_backup}."
log "$report"
scripts/notify.sh "$report"
