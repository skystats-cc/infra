# SkyStats server operations

You are running on the SkyStats home server (an Ubuntu laptop), in the `infra` repo. This repo runs the whole stack with Docker Compose. See README.md for the architecture.

## Use the skystats-ops tools first
- `status`: start every session here (containers, API readiness, queues, laptop load/memory/disk/battery/temperature).
- `logs`: one service's recent logs (`grep`, `since`).
- `config_get` / `config_set`: read and change `.env`. Secrets are masked. **Never read `.env` directly or print secret values.**
- `sql`: one read-only statement against Postgres.
- `restart`, `deploy`, `backup`, `list_backups`, `register_bot_commands`, `refresh_player`, `bazaar_snapshot`.

## Services
postgres · migrate (runs once) · api (`127.0.0.1:3000`, admin routes need `x-admin-key`) · worker (Hypixel ingestion, jobs) · web (`127.0.0.1:8080`) · bot · cloudflared (public traffic) · uptime-kuma (`127.0.0.1:3001`) · dozzle (`127.0.0.1:8081`).

## Rules
- Explain what you're about to change and why before `restart`, `config_set` or `deploy`.
- Never restore the database, delete volumes, `docker compose down -v`, or prune Docker. Tell the person the command and let them run it.
- Never commit `.env`, `.env.bak`, `cloudflared/credentials.json` or anything in `backups/`.
- Changes to files in this repo go on a new branch (`fix/...`, `feat/...`) and reach `main` through a PR. Don't commit to `main`.
- Code problems in the apps (server, web, bot, mod) are fixed in their own repos, not patched here. Diagnose, then describe the fix.

## Common tasks
- **"Is everything OK?"** → `status`, then `logs` with `grep: "error"` for anything unhealthy.
- **Site down** → `status`; check `cloudflared` and `web` logs; `api` readiness.
- **Ingestion stale** → `logs worker since 30m`; `sql`: `select max(polled_at) from bazaar_products`.
- **Change a setting** → `config_get`, then `config_set` (it recreates affected containers).
- **Ship new versions** → `deploy` (pulls images built by each repo's CI), then `status`.
