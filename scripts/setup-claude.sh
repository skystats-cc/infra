#!/usr/bin/env bash
# Install Claude Code and build the skystats-ops MCP server.
# Run from the infra repo as your normal user (NOT with sudo):  bash scripts/setup-claude.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(id -u)" -eq 0 ]; then echo "Run this as your normal user, not root."; exit 1; fi
if ! command -v node >/dev/null || ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)'; then
  echo "Node.js 22+ is required. Install it with: sudo bash scripts/setup-laptop.sh"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Can't talk to Docker. Is your user in the docker group? (log out and back in after setup-laptop.sh)"
  exit 1
fi

echo "==> Building the skystats-ops MCP server"
(cd mcp && npm ci --no-audit --no-fund && npm run build)

if ! command -v claude >/dev/null && [ ! -x "$HOME/.local/bin/claude" ]; then
  echo "==> Installing Claude Code (official installer)"
  curl -fsSL https://claude.ai/install.sh | bash
fi

cat <<MSG

Done. Next:
  cd $(pwd)
  claude
Sign in (over SSH, open the printed URL on your PC and paste the code back), trust this folder,
and approve the "skystats-ops" MCP server when Claude Code asks. Then try: "check the server status".
MSG
