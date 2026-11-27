# skystats infra

Everything needed to run SkyStats on the home server: one Docker Compose stack, a Cloudflare Tunnel for public access, backups, and deploy scripts.

```
internet ──► Cloudflare ──► cloudflared ─┬─► web (Caddy) ──► static site
                                         │        └── /v1, /healthz ──► api
                                         └─► api.skystats.cc ──► api   (/admin blocked)
api, worker ──► postgres        bot ──► api        migrate runs once before api/worker
```

| Service | Image | Exposed |
|---|---|---|
| postgres | `postgres:17-alpine` | nowhere (internal only) |
| migrate | `ghcr.io/skystats-cc/server` | runs once, then exits |
| api | `ghcr.io/skystats-cc/server` | `127.0.0.1:3000` (for Claude Code / MCP), public via tunnel |
| worker | `ghcr.io/skystats-cc/server` | – |
| web | `ghcr.io/skystats-cc/web` | `127.0.0.1:8080`, public via tunnel |
| bot | `ghcr.io/skystats-cc/discord-bot` | – |
| cloudflared *(profile `tunnel`)* | `cloudflare/cloudflared` | outbound only |
| uptime-kuma *(profile `monitoring`)* | `louislam/uptime-kuma` | `127.0.0.1:3001` |
| dozzle *(profile `monitoring`)* | `amir20/dozzle` | `127.0.0.1:8081` |

Nothing listens on the network except SSH. The tunnel only makes outbound connections. Use an SSH tunnel to reach the localhost dashboards from your PC: `ssh -L 3001:localhost:3001 -L 8081:localhost:8081 you@laptop`.

## First-time setup

### 1. The laptop
1. Install **Ubuntu Server 24.04 LTS** (enable OpenSSH during install). Wired ethernet + a fixed IP in your router if possible.
2. Clone this repo and run the setup script (installs Docker, firewall, auto-updates, lid-close/sleep fixes). Read it first:
   ```bash
   git clone https://github.com/skystats-cc/infra.git ~/skystats/infra
   cd ~/skystats/infra
   sudo bash scripts/setup-laptop.sh
   ```
3. Log out and back in. In the BIOS, enable "restore on AC power loss" if it exists.

### 2. Access to the images
Images are published to GitHub Container Registry by each repo's `docker.yml` workflow. For private repos, log in once with a GitHub token that has `read:packages`:
```bash
echo <TOKEN> | docker login ghcr.io -u <github-username> --password-stdin
```

### 3. Secrets
```bash
cp .env.example .env
nano .env       # passwords, ADMIN_API_KEY, Discord production bot token, etc.
```
Generate random values with `openssl rand -hex 32`.

### 4. Cloudflare Tunnel
skystats.cc's DNS must be on Cloudflare (free plan). The tunnel is token-based: routing lives in the Cloudflare dashboard, and the laptop only needs one token.

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** → **Cloudflared** → name it `skystats`.
2. On the install step, copy only the token (the long `eyJ…` string) into `.env` as `CLOUDFLARE_TUNNEL_TOKEN`. Skip the install command; Docker runs cloudflared.
3. Add **public hostnames** (Cloudflare creates the DNS records):

   | Hostname | Service |
   |---|---|
   | `skystats.cc` | HTTP → `web:80` |
   | `www.skystats.cc` | HTTP → `web:80` |
   | `api.skystats.cc` | HTTP → `api:3000` |

4. Keep admin routes off the internet: **Security → WAF → Custom rules → Create rule**: *Hostname equals `api.skystats.cc`* **and** *URI Path starts with `/admin`* → **Block**. (`skystats.cc/admin` is already blocked by the website's Caddy.)

Until the token is set, run without the tunnel: `COMPOSE_PROFILES=monitoring` in `.env`.

### 5. First deploy
```bash
scripts/deploy.sh
scripts/register-commands.sh      # registers the bot's slash commands
```
Check: `curl localhost:3000/readyz`, then open https://skystats.cc.

### 6. Backups (do this before you have data you care about)
```bash
crontab -e
# daily 04:15
15 4 * * * /home/<you>/skystats/infra/scripts/backup.sh >> /home/<you>/skystats/infra/backups/backup.log 2>&1
```
Set `RCLONE_REMOTE` in `.env` (after `rclone config`) so dumps also go off the laptop. **Test a restore** once: `scripts/restore.sh backups/<file>.dump`.

### 7. Monitoring
Open Uptime Kuma (`localhost:3001` via SSH tunnel) and add monitors for `https://skystats.cc`, `https://api.skystats.cc/healthz`, with a Discord webhook for alerts. Add an external free monitor too (UptimeRobot / Better Stack), since Uptime Kuma can't alert you if the whole laptop is down.

## Day to day

| Task | Command |
|---|---|
| Deploy latest `main` of every repo | `scripts/deploy.sh` |
| Re-register bot commands | `scripts/register-commands.sh` |
| Status | `docker compose ps` |
| Logs | `docker compose logs -f worker` (or Dozzle) |
| Restart one service | `docker compose restart api` |
| Backup now | `scripts/backup.sh` |
| Restore | `scripts/restore.sh backups/<file>.dump` |
| DB shell | `docker compose exec postgres psql -U skystats` |
| Pin a version | set `SERVER_TAG=0.3.1` in `.env`, `scripts/deploy.sh` |

## Running the whole stack on your own PC

With Docker Desktop and all repos side by side (`scripts/clone-all.sh`):
```bash
cp .env.example .env    # set COMPOSE_PROFILES= (empty) and dummy Discord values
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```
Site on http://localhost:8080, API on http://localhost:3000.

## Claude Code + MCP on the laptop

Point the MCP server at `http://localhost:3000/admin/*` with `x-admin-key: $ADMIN_API_KEY`. It can check queues, trigger snapshots and restart the API (Docker restarts it). It never needs database access.

## Claude Code on the server (skystats-ops MCP)

The `mcp/` folder is an MCP server that gives Claude Code safe, structured control of this stack: status, logs, masked config, read-only SQL, restart, deploy, backups and admin actions. `.mcp.json` registers it for this repo, `.claude/settings.json` decides what runs without asking, and `CLAUDE.md` is Claude's operating guide.

```bash
bash scripts/setup-claude.sh     # as your normal user: builds mcp/, installs Claude Code
cd ~/skystats/infra && claude    # sign in, trust the folder, approve "skystats-ops"
```

Over SSH, use `tmux` so a session survives disconnects: `tmux new -s claude`, then `claude`; reattach later with `tmux attach -t claude`.

| Runs without asking | Asks first | Blocked |
|---|---|---|
| status, logs, config_get (secrets masked), list_backups, sql (one read-only statement as a read-only DB role), backup, refresh_player, bazaar_snapshot, `docker compose ps/logs`, `git status/log/diff` | restart, config_set, deploy, register_bot_commands, `git push`, `sudo`, any other shell command | reading `.env` / Cloudflare credentials / backups, `restore.sh`, `docker compose down -v`, `docker volume rm`, `docker system prune`, `rm -rf` |

Database restores are deliberately not a tool. Run `scripts/restore.sh` yourself.

**Know what you're handing over:** Claude Code runs as your user, which is in the `docker` group, which is effectively root on this machine. The permission rules keep the risky actions behind a prompt; read those prompts before approving.

See **ROADMAP.md** for where this goes next.
