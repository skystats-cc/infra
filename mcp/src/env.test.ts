import { describe, expect, it } from 'vitest';
import { isSecret, parseEnv, redactedView, setEnvValue } from './env.js';

const sample = `# comment
POSTGRES_USER=skystats
POSTGRES_PASSWORD=hunter2
DISCORD_TOKEN=
HYPIXEL_API_KEY=abc123
RATE_LIMIT_PER_MIN=120
BAZAAR_SNAPSHOT_CRON=0 */2 * * *
`;

describe('env', () => {
  it('detects secrets', () => {
    expect(isSecret('POSTGRES_PASSWORD')).toBe(true);
    expect(isSecret('HYPIXEL_API_KEY')).toBe(true);
    expect(isSecret('DISCORD_TOKEN')).toBe(true);
    expect(isSecret('RATE_LIMIT_PER_MIN')).toBe(false);
  });

  it('never shows secret values', () => {
    const view = redactedView(sample);
    expect(view).not.toContain('hunter2');
    expect(view).not.toContain('abc123');
    expect(view).toContain('POSTGRES_PASSWORD=•••• (set)');
    expect(view).toContain('DISCORD_TOKEN=(empty)');
    expect(view).toContain('BAZAAR_SNAPSHOT_CRON=0 */2 * * *');
  });

  it('updates in place and appends new keys', () => {
    const updated = setEnvValue(sample, 'RATE_LIMIT_PER_MIN', '300');
    expect(updated).toContain('RATE_LIMIT_PER_MIN=300');
    expect(updated.startsWith('# comment\n')).toBe(true);
    const added = setEnvValue(sample, 'LOG_LEVEL', 'debug');
    expect(parseEnv(added).at(-1)).toEqual({ key: 'LOG_LEVEL', value: 'debug' });
  });

  it('rejects bad input', () => {
    expect(() => setEnvValue(sample, 'bad-key', 'x')).toThrow();
    expect(() => setEnvValue(sample, 'OK', 'a\nB=c')).toThrow();
  });
});
