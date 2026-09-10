import { spawn } from 'node:child_process';

/** Run a command without a shell; interactive commands retain terminal prompts. */
export function runCommand(executable, args, { cwd, env = process.env, interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd, env, stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    if (!interactive) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-128_000); });
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-128_000); });
    }
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
