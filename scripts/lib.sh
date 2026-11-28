# shellcheck shell=bash
# Shared helpers for scripts/. Source this, don't run it.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Read one value from .env without sourcing it (values may contain spaces/*)
env_get() {
  local v
  v=$(grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- || true)
  printf '%s' "${v:-${2:-}}"
}

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[ -f .env ] || die ".env not found; copy .env.example to .env first"
