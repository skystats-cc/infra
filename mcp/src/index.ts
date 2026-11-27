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
const SERVICES = ['postgres', 'migrate', 'api', 'worker', 'web', 'bot', 'cloudflared', 'uptime-kuma', 'dozzle'] as const;

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

async function admin(method: 'GET' | 'POST', path: string) {
  const key = await envValue('ADMIN_API_KEY');
  const res = await fetch(`${API}/admin${path}`, {
    method,
    headers: { 'x-admin-key': key },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.text();
  return { status: res.status, body };
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

// Database restores are deliberately not a tool: run scripts/restore.sh yourself.

await server.connect(new StdioServerTransport());
console.error(`skystats-ops MCP ready (infra: ${INFRA}, api: ${API})`);
