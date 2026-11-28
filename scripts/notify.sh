#!/usr/bin/env bash
# Post a short message to the ops Discord channel (OPS_DISCORD_WEBHOOK_URL in .env). No-op if unset.
#   scripts/notify.sh "Deploy rolled back: api failed its health check"
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

url=$(env_get OPS_DISCORD_WEBHOOK_URL)
msg="${1:-}"
[ -n "$msg" ] || die "usage: scripts/notify.sh <message>"
[ -n "$url" ] || { log "OPS_DISCORD_WEBHOOK_URL not set; not sending: $msg"; exit 0; }
host=$(hostname -s)
# jq builds the JSON so quotes in the message can't break it; mentions are disabled
payload=$(jq -n --arg c "[$host] $msg" '{content: $c, allowed_mentions: {parse: []}}')
curl -fsS -m 10 -H 'content-type: application/json' -d "$payload" "$url" >/dev/null || log "Discord notify failed"
