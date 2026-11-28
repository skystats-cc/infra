# Infrastructure roadmap

> Product features, their legal rules and the phase plan live in [docs/uk-compliance.md](docs/uk-compliance.md).

What we have now is deliberately simple: one laptop, one Compose stack, images built by CI, a tunnel, nightly backups. Below are the upgrades, roughly in the order they start paying off. Each is independent, so pick them up as PRs.

## 1. Deployment

- [ ] **Continuous deployment.** On merge to `main`, a GitHub Action connects over **Tailscale** (no open ports) and runs `scripts/deploy.sh`. Nobody needs to SSH in to ship.
- [ ] **Release tags + pinned versions.** Tag `v1.2.0` in each repo → image `:1.2.0`; production `.env` pins tags, `main` only goes to staging. Rollback = change a tag.
- [ ] **Staging environment.** A second Compose project (`-p skystats-staging`) on the same box with its own DB and `staging.skystats.cc`, tracking `main`.
- [ ] **PR preview builds** for `web` (Cloudflare Pages previews of the static build, pointed at staging API).
- [ ] **Renovate / Dependabot** across all repos, including Docker base images and the `api-spec` client version.
- [ ] **Zero-downtime API deploys**: run 2 API replicas behind Caddy and roll them one at a time.

## 2. Observability

- [ ] **Metrics endpoint** in the server (`/metrics`, Prometheus format): request latency per route, Hypixel call count/latency/errors, rate-limit remaining, poll lag (`now - bazaar.lastUpdated`), snapshot row counts, pg-boss queue depth.
- [ ] **Prometheus + Grafana** (new `monitoring` services) with dashboards for API, ingestion freshness, Postgres, and the host (node-exporter: CPU temp, disk, battery!).
- [ ] **Alerting to Discord**: ingestion stale > 2 min, error rate spike, disk > 80%, backup missing for 26h, laptop on battery.
- [ ] **Centralised logs**: Loki + Promtail (or Grafana Alloy), queryable from Grafana. Add request IDs that flow web → api → logs.
- [ ] **Error tracking**: Sentry (or self-hosted GlitchTip) for server, bot and web.
- [ ] **Public status page** for SkyStats itself (Uptime Kuma status page on `status.skystats.cc`).

## 3. Data

- [ ] **TimescaleDB** (swap `postgres:17` for the Timescale image): make `bazaar_snapshots` a hypertable, turn on native compression (often 10×+ smaller), and use **continuous aggregates** for hourly/daily candles so charts never scan raw rows.
- [x] **Tier-based retention** job (phase 1, in the server): FREE 7d / PRO 90d / MAX unlimited is about *access*, but raw data older than N days can be downsampled to hourly/daily aggregates to keep the DB small.
- [ ] **Higher-resolution history** once storage is solved: keep the 30s poll data for 24–48h for intraday charts and anomaly detection.
- [ ] **Redis** (or Valkey) as a hot cache for `/v1/bazaar` and for pub/sub of live price updates.
- [ ] **Realtime push**: Server-Sent Events or WebSocket endpoint for the live bazaar page instead of polling.
- [ ] **Read replica / analytics store** later (ClickHouse is the usual next step for heavy time-series analytics).

## 4. API

- [ ] **API keys + per-tier rate limits** (replace per-IP limits for authenticated users), stored in Postgres, cached in Redis.
- [ ] **Contract tests**: server CI validates every response against `api-spec/openapi.yaml`.
- [ ] **Hosted API docs** at `api.skystats.cc/docs` (Redoc build from `api-spec`).
- [ ] **HTTP caching**: `Cache-Control` + `ETag` on bazaar endpoints so Cloudflare serves most reads from its edge (bazaar only changes every ~20–60s).
- [ ] **Versioning policy enforced**: breaking changes → `/v2`, with `/v1` kept until the mod and bot migrate.

## 5. Security

- [ ] **Cloudflare WAF + rate-limiting rules** at the edge (blocks abuse before it reaches the laptop).
- [ ] **Cloudflare Access** in front of the monitoring dashboards so they're reachable without SSH tunnels, protected by your Discord/GitHub login.
- [ ] **Secrets management**: encrypt `.env` with **sops + age** and commit it, or use Doppler/Infisical. Rotate tokens on a schedule.
- [ ] **Discord OAuth** for the website (also the basis for accounts, subscriptions and co-op linking).
- [ ] **Image scanning** (Trivy in each repo's Docker workflow) and **SBOMs**.
- [ ] **Branch protection** on every repo: PR + review + green CI required for `main`.

## 6. Reliability & hardware

- [ ] **Backups**: off-site copy (rclone → Backblaze B2, age-encrypted since phase 1), monthly automated restore test into a throwaway container, and alert if a backup is missing.
- [ ] **Point-in-time recovery**: WAL archiving with pgBackRest or WAL-G (lose minutes, not a day, on disk failure).
- [ ] **SSD health monitoring** (smartctl) and battery/AC alerts; a cheap UPS for the router too.
- [ ] **Second machine** in the home lab: Postgres streaming replica + standby app stack, so either box can fail.
- [ ] **Cloud fallback**: the same Compose file runs on a €5/month VPS if the house loses power for a day.

## 7. Platform (when the home lab grows)

- [ ] **Proxmox** on new hardware to split services into VMs/LXCs.
- [ ] **k3s** (lightweight Kubernetes) once there are 3+ nodes: rolling deploys, auto-restarts across machines, Helm charts per repo.
- [ ] **GitOps** with Argo CD or Flux: the cluster state is whatever is in this repo.
- [ ] **Self-hosted GitHub Actions runner** on the home lab for faster builds with warm caches.

## 8. Product infrastructure

- [ ] **Stripe**: webhook handler service (idempotent, verifies signatures), subscription state in Postgres, tier checks in API middleware.
- [ ] **MMM module system**: each money-making method as a server module with its own jobs/tables/routes, toggled per tier (FREE basic, PRO advanced, MAX all + beta).
- [ ] **Anomaly detection worker** on bazaar data (z-score / rolling median deviation) → notifications service → Discord DMs, channel alerts, web push.
- [ ] **Mod telemetry ingestion endpoint** (authenticated, batched, rate-limited) feeding co-op/grinding stats, with the opt-out flag surfaced on profiles.
- [ ] **Per-player Hypixel polling scheduler** that spreads keyed API calls across the 5-minute window and prioritises active/paying users.
