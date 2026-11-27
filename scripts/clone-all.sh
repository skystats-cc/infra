#!/usr/bin/env bash
# Clone every SkyStats repo next to this one (for docker-compose.local.yml and dev).
set -euo pipefail
cd "$(dirname "$0")/../.."
for repo in server web discord-bot api-spec; do
  if [ -d "$repo" ]; then
    echo "skip $repo (exists)"
  else
    git clone "https://github.com/skystats-cc/$repo.git"
  fi
done
