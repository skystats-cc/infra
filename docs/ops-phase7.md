# Ops guide (phase 7)

## Deploys and rollback
`scripts/deploy.sh` now tags the running images as `:rollback`, pulls, starts the stack and checks
`/readyz` on the api and the web front page for up to a minute. If anything fails it starts the
`:rollback` images again and posts to the ops channel. `scripts/deploy.sh --rollback` (or the
`rollback` MCP tool) does the same by hand.

Migrations are forward-only, so a rollback runs old code on the new schema. Keep migrations
additive (new tables and nullable columns); drop columns only one release after the code stops
using them.

## Staging
`scripts/staging.sh up` runs a second copy of the stack (project `skystats-staging`, its own
database, api on :3100, web on :8180) with the `:staging` images and `.env.staging`. Use Stripe
**test** keys and a separate test bot there. If testers outside the house need it, add a
`staging.skystats.cc` hostname to the tunnel and put it behind Cloudflare Access.

## Observability (profile `observability`)
1. `scripts/observability-setup.sh` (creates METRICS_TOKEN and the token file Prometheus reads).
2. Set `GRAFANA_ADMIN_PASSWORD`, add `observability` to `COMPOSE_PROFILES`, `docker compose up -d`.
3. Grafana at http://localhost:3002 has the SkyStats overview dashboard (requests, p95 latency,
   jobs, live streams, memory, event-loop lag) and Loki for logs. Logs are kept 14 days.

It uses about 600 MB of memory, so on the laptop turn it on when you need it. `/metrics` answers
404 without the token and refuses anything that came through Cloudflare.

## Error tracking
Set `SENTRY_DSN` (api and worker) and `BOT_SENTRY_DSN`. A self-hosted GlitchTip works too. User
ids, IP addresses, cookies, request bodies and auth headers are removed before anything is sent.
With a hosted service outside the UK, add it to the processors list in the privacy notice.

## Cron on the laptop
```
15 4 * * *    infra/scripts/backup.sh          >> infra/backups/backup.log 2>&1
*/10 * * * *  infra/scripts/laptop-health.sh   >> infra/backups/health.log 2>&1
* * * * *     infra/scripts/power-watch.sh     >> infra/backups/power.log 2>&1
0 5 1-7 * 0   infra/scripts/restore-drill.sh   >> infra/backups/drill.log 2>&1
7 9 * * 1     infra/scripts/weekly-report.sh   >> infra/backups/report.log 2>&1
```
- **Power**: on battery at or below `POWER_STOP_AT_PERCENT`, power-watch takes a backup and stops
  the stack cleanly, then starts it when the charger is back. Also set the BIOS to power on after
  AC loss, and keep the lid-close action as "do nothing".
- **Restore drill**: restores the newest dump into a throwaway container and reports counts. It
  never touches the live database.

## External uptime checks
Uptime Kuma runs on the laptop, so it can't tell you the laptop is down. Add one outside check:
- A free external monitor (e.g. UptimeRobot, Better Stack or Cloudflare Health Checks) on
  `https://skystats.cc/healthz` and `https://skystats.cc/v1/status` every 5 minutes.
- Point its alerts at the same ops Discord webhook, or email.
- In Uptime Kuma, add a "push" monitor that the weekly report and laptop-health cron hit, so a
  dead cron shows up too.

## Cloudflare WAF and rate limiting (dashboard, not this repo)
- Security → WAF → custom rules:
  - Block `/admin*` and `/metrics` from the internet. The tunnel shouldn't route them, but
    defence in depth.
  - Managed challenge on `/v1/auth/*` and `/v1/pairing*` when the threat score is high.
- Security → WAF → rate limiting rules (free plan has one): 100 requests / 10 s per IP on `/v1/*`,
  action "block for 1 minute".
- Bots → Bot Fight Mode on. Exclude `/v1/bazaar/stream` from caching (Cache Rules → bypass), and
  give it a longer proxy read timeout if streams drop.
- SSL/TLS → Full (strict); "Always use HTTPS"; minimum TLS 1.2; HSTS once everything works.

## Secrets with SOPS (optional)
`.env` stays the live file on the laptop and is never committed. To keep an encrypted copy in a
private repo or password manager:
```
sudo apt install age && curl -LO https://github.com/getsops/sops/releases/latest/download/sops-linux-amd64
age-keygen -o ~/.config/sops/age/keys.txt          # back up this key offline
sops --encrypt --age <age1 public key> --input-type dotenv --output-type dotenv .env > env.sops
sops --decrypt --input-type dotenv --output-type dotenv env.sops > .env   # on a new laptop
```
Each team member who needs access gets their own age key added as a recipient. Rotate
`ADMIN_API_KEY`, `BOT_API_KEY`, `CLOUDFLARE_TUNNEL_TOKEN` and the Stripe keys when someone leaves.

## Dependency updates
Every repo has a `renovate.json` (weekend PRs, minor and patch grouped, security fixes at any
time). Install the Renovate GitHub App on the skystats-cc org to turn it on.
