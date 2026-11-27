import { execFile } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a program with arguments (no shell, so nothing the model sends is ever interpreted by bash). */
export function run(cmd: string, args: string[], opts: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }) {
  return new Promise<RunResult>((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 60_000, maxBuffer: 20 * 1024 * 1024, env: opts.env ?? process.env },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err && !stderr ? err.message : '') });
      },
    );
  });
}

/** Keep tool output small enough to be useful in a conversation */
export function clip(text: string, maxChars = 12_000): string {
  if (text.length <= maxChars) return text;
  return `…(${text.length - maxChars} earlier characters omitted)\n` + text.slice(-maxChars);
}
