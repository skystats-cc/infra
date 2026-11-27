import { readdir, readFile } from 'node:fs/promises';
import { statfs } from 'node:fs/promises';

const read = (p: string) => readFile(p, 'utf8').then((s) => s.trim()).catch(() => null);
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** Laptop health: load, memory, disk, battery, temperature (best effort, Linux only) */
export async function hostHealth(diskPath: string): Promise<string> {
  const lines: string[] = [];

  const uptime = await read('/proc/uptime');
  if (uptime) lines.push(`uptime: ${(Number(uptime.split(' ')[0]) / 3600).toFixed(1)} h`);

  const load = await read('/proc/loadavg');
  if (load) lines.push(`load (1/5/15 min): ${load.split(' ').slice(0, 3).join(' ')}`);

  const meminfo = await read('/proc/meminfo');
  if (meminfo) {
    const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(meminfo)?.[1] ?? 0) * 1024;
    lines.push(`memory: ${gb(kb('MemTotal') - kb('MemAvailable'))} used of ${gb(kb('MemTotal'))}`);
  }

  try {
    const fs = await statfs(diskPath);
    const total = fs.blocks * fs.bsize;
    const free = fs.bavail * fs.bsize;
    lines.push(`disk: ${gb(total - free)} used of ${gb(total)} (${Math.round(((total - free) / total) * 100)}%)`);
  } catch {
    /* ignore */
  }

  const supplies = await readdir('/sys/class/power_supply').catch(() => []);
  for (const s of supplies.filter((n) => n.startsWith('BAT'))) {
    const capacity = await read(`/sys/class/power_supply/${s}/capacity`);
    const status = await read(`/sys/class/power_supply/${s}/status`);
    if (capacity) lines.push(`battery ${s}: ${capacity}% (${status ?? 'unknown'})`);
  }
  for (const s of supplies.filter((n) => /^(AC|ADP)/.test(n))) {
    const online = await read(`/sys/class/power_supply/${s}/online`);
    if (online !== null) lines.push(`mains power: ${online === '1' ? 'connected' : 'DISCONNECTED (running on battery)'}`);
  }

  const zones = await readdir('/sys/class/thermal').catch(() => []);
  const temps: number[] = [];
  for (const z of zones.filter((n) => n.startsWith('thermal_zone'))) {
    const t = await read(`/sys/class/thermal/${z}/temp`);
    if (t && Number(t) > 0) temps.push(Number(t) / 1000);
  }
  if (temps.length) lines.push(`max temperature: ${Math.max(...temps).toFixed(0)}°C`);

  return lines.join('\n');
}
