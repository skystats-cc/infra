#!/usr/bin/env bash
# Register the Discord bot's slash commands (run after changing commands).
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"
docker compose run --rm --no-deps bot node dist/deploy-commands.js
