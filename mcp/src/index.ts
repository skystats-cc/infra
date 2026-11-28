#!/usr/bin/env node
/**
 * skystats-ops: an MCP server that lets Claude Code operate the SkyStats stack on the home server.
 *
 * Every action goes through docker compose / the repo's scripts / the API's localhost-only admin routes.
 * Secrets in .env are never returned to the model. Read-only tools are marked readOnlyHint; anything
 * that changes the server is marked destructiveHint so Claude Code asks first (see .claude/settings.json).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { copyFile, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { KEY_RE, isSecret, parseEnv, redactedView, setEnvValue } from './env.js';
import { hostHealth } from './host.js';
import { clip, run } from './run.js';
import { singleStatement } from './sql.js';

// infra/mcp/dist/index.js -> infra/
const INFRA = resolve(process.env.SKYSTATS_INFRA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const ENV_FILE = join(INFRA, '.env');
const API = (process.env.SKYSTATS_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const SERVICES = ['postgres', 'migrate', 'api', 'worker', 'web', 'bot', 'cloudflared', 'uptime-kuma', 'dozzle', 'prometheus', 'loki', 'promtail', 'grafana'] as const;

type Text = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (text: string): Text => ({ content: [{ type: 'text', text }] });
const fail = (text: string): Text => ({ content: [{ type: 'text', text }], isError: true });

const compose = (args: string[], timeoutMs?: number) => run('docker', ['compose', ...args], { cwd: INFRA, timeoutMs });
const script = (name: string, args: string[] = [], timeoutMs = 15 * 60_000) =>
  run('bash', [join(INFRA, 'scripts', name), ...args], { cwd: INFRA, timeoutMs });

async function envValue(key: string) {
  const text = await readFile(ENV_FILE, 'utf8');
  return parseEnv(text).find((l) => l.key === key)?.value ?? '';
}

async function admin(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) {
  const key = await envValue('ADMIN_API_KEY');
  const res = await fetch(`${API}/admin${path}`, {
    method,
    headers: { 'x-admin-key': key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

const result = (r: { code: number; stdout: string; stderr: string }, label: string) =>
  r.code === 0
    ? ok(clip(`${label} succeeded.\n${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`))
    : fail(clip(`${label} failed (exit ${r.code}).\n${r.stdout}\n${r.stderr}`));

const server = new McpServer({ name: 'skystats-ops', version: '0.1.0' });

// ---------------------------------------------------------------- read-only

server.registerTool(
  'status',
  {
    title: 'Stack status',
    description:
      'Overview of the SkyStats server: every container and its health, API readiness, job queue sizes, and laptop health (load, memory, disk, battery, temperature). Start here.',
    annotations: { readOnlyHint: true },
  },
  async () => {
    const parts: string[] = [];
    const ps = await compose(['ps', '--all', '--format', 'table {{.Service}}\t{{.State}}\t{{.Status}}']);
    parts.push('## Containers', ps.code === 0 ? ps.stdout.trim() : `docker compose ps failed: ${ps.stderr}`);

    try {
      const ready = await fetch(`${API}/readyz`, { signal: AbortSignal.timeout(5000) });
      parts.push('## API', `readyz: ${ready.status} ${await ready.text()}`);
      const queues = await admin('GET', '/queues');
      parts.push(`queues: ${queues.body}`);
    } catch (err) {
      parts.push('## API', `unreachable on ${API}: ${(err as Error).message}`);
    }

    parts.push('## Host', await hostHealth(INFRA));
    return ok(parts.join('\n'));
  },
);

server.registerTool(
  'logs',
  {
    title: 'Service logs',
    description: 'Recent logs for one service. Use `grep` to filter lines (case-insensitive) and `since` like "15m" or "2h".',
    inputSchema: {
      service: z.enum(SERVICES),
      lines: z.number().int().min(10).max(2000).default(200),
      since: z
        .string()
        .regex(/^\d+[smhd]$/)
        .optional()
        .describe('e.g. 10m, 2h, 1d'),
      grep: z.string().max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ service, lines, since, grep }) => {
    const args = ['logs', '--no-color', '--tail', String(lines), ...(since ? ['--since', since] : []), service];
    const r = await compose(args);
    if (r.code !== 0) return fail(r.stderr || r.stdout);
    let out = r.stdout + r.stderr;
    if (grep) {
      const needle = grep.toLowerCase();
      out = out
        .split('\n')
        .filter((l) => l.toLowerCase().includes(needle))
        .join('\n');
    }
    return ok(clip(out || '(no matching log lines)'));
  },
);

server.registerTool(
  'config_get',
  {
    title: 'Show configuration',
    description:
      'Show the stack configuration (.env). Secret values (keys, tokens, passwords) are masked as "•••• (set)" or "(empty)".',
    annotations: { readOnlyHint: true },
  },
  async () => ok(redactedView(await readFile(ENV_FILE, 'utf8'))),
);

server.registerTool(
  'list_backups',
  {
    title: 'List backups',
    description: 'Database backups in backups/, newest first, with sizes and ages.',
    annotations: { readOnlyHint: true },
  },
  async () => {
    const dir = join(INFRA, 'backups');
    const names = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.dump'));
    if (!names.length) return ok('No backups yet. Run the backup tool, and schedule scripts/backup.sh in cron.');
    const rows = await Promise.all(
      names.map(async (n) => {
        const s = await stat(join(dir, n));
        return { n, size: s.size, age: (Date.now() - s.mtimeMs) / 3_600_000 };
      }),
    );
    rows.sort((a, b) => a.age - b.age);
    return ok(rows.map((r) => `${r.n}  ${(r.size / 1024 ** 2).toFixed(1)} MB  ${r.age.toFixed(1)} h ago`).join('\n'));
  },
);

const READONLY_ROLE = 'skystats_readonly';
let roleReady = false;

/** psql inside the postgres container as the stack's DB user */
async function psql(args: string[]) {
  const user = (await envValue('POSTGRES_USER')) || 'skystats';
  const db = (await envValue('POSTGRES_DB')) || 'skystats';
  return compose(['exec', '-T', 'postgres', 'psql', '-U', user, '-d', db, '-v', 'ON_ERROR_STOP=1', ...args], 30_000);
}

server.registerTool(
  'sql',
  {
    title: 'Read-only SQL',
    description:
      'Run ONE read-only SQL statement against the SkyStats database (no semicolons inside; runs as a read-only role in a READ ONLY transaction, 10s timeout, CSV output, first 200 rows). Tables include players, accounts, sessions, skyblock_profiles, profile_members, member_snapshots, bazaar_products, bazaar_snapshots, hypixel_status.',
    inputSchema: { query: z.string().min(1).max(4000) },
    annotations: { readOnlyHint: true },
  },
  async ({ query }) => {
    const statement = singleStatement(query);
    if (!statement) return fail('Send a single statement (no ";" in the middle).');

    // The image's DB user is a superuser, so queries run as a role that can only read table data
    if (!roleReady) {
      const setup = await psql([
        '-c',
        `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${READONLY_ROLE}') THEN ` +
          `CREATE ROLE ${READONLY_ROLE} NOLOGIN; GRANT pg_read_all_data TO ${READONLY_ROLE}; END IF; END $$`,
      ]);
      if (setup.code !== 0) return fail(clip(`Couldn't prepare the read-only role:\n${setup.stderr}`));
      roleReady = true;
    }

    const r = await psql([
      '--csv',
      '-c', 'BEGIN READ ONLY',
      '-c', "SET LOCAL statement_timeout = '10s'",
      '-c', `SET LOCAL ROLE ${READONLY_ROLE}`,
      '-c', statement,
      '-c', 'ROLLBACK',
    ]);
    if (r.code !== 0) return fail(clip(r.stderr || r.stdout));
    // psql prints "BEGIN"/"SET"/"ROLLBACK" status lines around the result
    const lines = r.stdout.split('\n').filter((l) => !/^(BEGIN|SET|ROLLBACK)$/.test(l));
    const shown = lines.slice(0, 201);
    const more = lines.length > 201 ? `\n…${lines.length - 201} more rows` : '';
    return ok(clip(shown.join('\n') + more));
  },
);

// ---------------------------------------------------------------- changes the server

server.registerTool(
  'restart',
  {
    title: 'Restart a service',
    description: 'Restart one container (e.g. api after a config change). Use "all" to recreate the whole stack with the current .env.',
    inputSchema: { service: z.enum([...SERVICES, 'all']) },
    annotations: { destructiveHint: true },
  },
  async ({ service }) =>
    service === 'all'
      ? result(await compose(['up', '-d', '--remove-orphans'], 5 * 60_000), 'Recreate stack')
      : result(await compose(['restart', service], 2 * 60_000), `Restart ${service}`),
);

server.registerTool(
  'config_set',
  {
    title: 'Change configuration',
    description:
      'Set one .env value (a backup is written to .env.bak first), then recreate the containers it affects. Secret values are written but never echoed back.',
    inputSchema: {
      key: z.string().regex(KEY_RE).describe('e.g. RATE_LIMIT_PER_MIN'),
      value: z.string().max(2000),
      apply: z.boolean().default(true).describe('Recreate changed containers now'),
    },
    annotations: { destructiveHint: true },
  },
  async ({ key, value, apply }) => {
    const before = await readFile(ENV_FILE, 'utf8');
    await copyFile(ENV_FILE, `${ENV_FILE}.bak`);
    await writeFile(ENV_FILE, setEnvValue(before, key, value), { mode: 0o600 });
    const shown = isSecret(key) ? '•••• (hidden)' : value;
    if (!apply) return ok(`Set ${key}=${shown}. Not applied yet; use restart "all" to apply.`);
    const r = await compose(['up', '-d', '--remove-orphans'], 5 * 60_000);
    return r.code === 0
      ? ok(clip(`Set ${key}=${shown} and recreated affected containers.\n${r.stderr}`))
      : fail(clip(`Set ${key}=${shown}, but applying failed (previous file saved as .env.bak):\n${r.stderr}`));
  },
);

server.registerTool(
  'deploy',
  {
    title: 'Deploy latest',
    description: 'git pull the infra repo, pull the newest images for every service, run migrations and restart what changed (scripts/deploy.sh).',
    annotations: { destructiveHint: true },
  },
  async () => result(await script('deploy.sh'), 'Deploy'),
);

server.registerTool(
  'backup',
  {
    title: 'Back up the database now',
    description: 'Run scripts/backup.sh: pg_dump to backups/, prune old dumps, copy off-site if RCLONE_REMOTE is set.',
    annotations: { destructiveHint: false },
  },
  async () => result(await script('backup.sh'), 'Backup'),
);

server.registerTool(
  'register_bot_commands',
  {
    title: 'Register Discord slash commands',
    description: 'Re-register the Discord bot\'s slash commands (after a bot update that changed commands).',
    annotations: { destructiveHint: false },
  },
  async () => result(await script('register-commands.sh', [], 2 * 60_000), 'Register commands'),
);

server.registerTool(
  'refresh_player',
  {
    title: 'Refresh a player',
    description: "Fetch a player's SkyBlock profiles from Hypixel now (ignores the 5-minute refresh interval). Takes a Minecraft UUID.",
    inputSchema: { uuid: z.string().regex(/^[0-9a-fA-F-]{32,36}$/) },
    annotations: { destructiveHint: false },
  },
  async ({ uuid }) => {
    const r = await admin('POST', `/players/${uuid.replace(/-/g, '')}/refresh`);
    return r.status < 300 ? ok(`Queued: ${r.body}`) : fail(`API returned ${r.status}: ${r.body}`);
  },
);

server.registerTool(
  'bazaar_snapshot',
  {
    title: 'Take a bazaar snapshot',
    description: 'Copy current bazaar prices into history now instead of waiting for the 2-hour schedule.',
    annotations: { destructiveHint: false },
  },
  async () => {
    const r = await admin('POST', '/bazaar/snapshot');
    return r.status < 300 ? ok(`Queued: ${r.body}`) : fail(`API returned ${r.status}: ${r.body}`);
  },
);


// ---------------------------------------------------------------- phase 7: platform

const adminText = async (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => {
  const r = await admin(method, path, body);
  return r.status < 300 ? ok(clip(r.body || `${r.status} OK`)) : fail(`API returned ${r.status}: ${clip(r.body)}`);
};

server.registerTool(
  'jobs',
  {
    title: 'Job health',
    description: 'Every scheduled job and loop with its last success, last error and whether it missed its window (late). Add failed: true for the last 50 failed queue jobs.',
    inputSchema: { failed: z.boolean().default(false) },
    annotations: { readOnlyHint: true },
  },
  async ({ failed }) => adminText('GET', failed ? '/jobs/failed' : '/jobs'),
);

server.registerTool(
  'retry_job',
  {
    title: 'Retry a failed job',
    description: 'Retry one failed queue job (ids from jobs with failed: true).',
    inputSchema: { queue: z.string().regex(/^[a-z.-]+$/), id: z.string().uuid() },
    annotations: { destructiveHint: false },
  },
  async ({ queue, id }) => adminText('POST', `/jobs/${queue}/${id}/retry`),
);

server.registerTool(
  'data_quality',
  {
    title: 'Data-quality checks',
    description: 'Negative balances, duplicate snapshots, bazaar data age, profile resets this week, banned accounts. Plus mod version counts for the last 30 days.',
    annotations: { readOnlyHint: true },
  },
  async () => {
    const [dq, mv] = await Promise.all([admin('GET', '/data-quality'), admin('GET', '/mod-versions')]);
    return dq.status < 300 ? ok(clip(`${dq.body}\nmod versions: ${mv.body}`)) : fail(`API returned ${dq.status}: ${dq.body}`);
  },
);

server.registerTool(
  'flags',
  {
    title: 'Feature flags',
    description: 'List feature flags, or set one (enabled, optional minimum tier, rollout percentage).',
    inputSchema: {
      set: z
        .object({
          key: z.string().regex(/^[a-z0-9.-]{2,48}$/),
          enabled: z.boolean(),
          minTier: z.enum(['free', 'pro', 'max']).nullable().optional(),
          rolloutPercent: z.number().int().min(0).max(100).optional(),
          description: z.string().max(200).optional(),
        })
        .optional(),
    },
    annotations: { destructiveHint: true },
  },
  async ({ set }) => (set ? adminText('PUT', `/flags/${set.key}`, { ...set, key: undefined }) : adminText('GET', '/flags')),
);

server.registerTool(
  'user_lookup',
  {
    title: 'Look up a user (support)',
    description: 'Account id, plan, mod version and ban state for a Minecraft username or UUID. No money data. Only use it to answer a support request.',
    inputSchema: { q: z.string().min(1).max(36) },
    annotations: { readOnlyHint: true },
  },
  async ({ q }) => adminText('GET', `/users/${encodeURIComponent(q)}`),
);

server.registerTool(
  'rollback',
  {
    title: 'Roll back the last deploy',
    description: 'Run scripts/deploy.sh --rollback: start the images that were running before the last deploy (tagged :rollback). Migrations are not undone.',
    annotations: { destructiveHint: true },
  },
  async () => result(await script('deploy.sh', ['--rollback']), 'Rollback'),
);

server.registerTool(
  'laptop_health',
  {
    title: 'Laptop health check',
    description: 'Run scripts/laptop-health.sh now: disk, memory, temperature, battery wear and charger, SMART, unhealthy containers. Alerts the ops channel if something is wrong.',
    annotations: { destructiveHint: false },
  },
  async () => result(await script('laptop-health.sh', [], 60_000), 'Laptop health'),
);

server.registerTool(
  'notify_ops',
  {
    title: 'Post to the ops channel',
    description: 'Send a short message to the ops Discord webhook (no personal data).',
    inputSchema: { message: z.string().min(1).max(500) },
    annotations: { destructiveHint: false },
  },
  async ({ message }) => result(await script('notify.sh', [message], 30_000), 'Notify'),
);

// Bans, plan overrides and comps are deliberately not tools: they affect a real person, so use the
// admin API by hand (see docs/runbook-admin.md) after checking the request.

// Database restores (and restore drills) are deliberately not tools: run scripts/restore.sh or
// scripts/restore-drill.sh yourself.

await server.connect(new StdioServerTransport());
console.error(`skystats-ops MCP ready (infra: ${INFRA}, api: ${API})`);
