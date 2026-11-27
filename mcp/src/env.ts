// Read/write the stack's .env without ever handing secret values back to the model.

const SECRET = /(KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL)/i;
export const KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export const isSecret = (key: string) => SECRET.test(key);

export interface EnvLine {
  key: string;
  value: string;
}

export function parseEnv(text: string): EnvLine[] {
  const out: EnvLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m) out.push({ key: m[1]!, value: m[2]!.trim() });
  }
  return out;
}

/** KEY=value lines with secrets masked: set ones show "•••• (set)", empty ones "(empty)" */
export function redactedView(text: string): string {
  return parseEnv(text)
    .map(({ key, value }) => {
      if (!isSecret(key)) return `${key}=${value}`;
      return `${key}=${value ? '•••• (set)' : '(empty)'}`;
    })
    .join('\n');
}

/** Replace KEY's value in place (keeps comments and order), or append it if missing */
export function setEnvValue(text: string, key: string, value: string): string {
  if (!KEY_RE.test(key)) throw new Error(`Invalid key "${key}" (use UPPER_SNAKE_CASE)`);
  if (/[\r\n]/.test(value)) throw new Error('Values cannot contain newlines');
  const lines = text.split(/\r?\n/);
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const idx = lines.findIndex((l) => re.test(l));
  if (idx >= 0) {
    lines[idx] = `${key}=${value}`;
  } else {
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(`${key}=${value}`, '');
  }
  return lines.join('\n');
}
