import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { docShelfRoot, runtimeRoot } from './artifacts.mjs';
import { watcherLogPaths } from './log-trim.mjs';
import { browserHost } from './server-security.mjs';
import { inspectWatcherLock, watcherLockPath } from './watcher-lock.mjs';

const command = process.argv[2];
const label = 'local.docshelf.watch';
const userId = process.getuid?.();
const userHome = homedir();
const launchAgentsDirectory = path.join(userHome, 'Library', 'LaunchAgents');
const plistPath = path.join(launchAgentsDirectory, `${label}.plist`);
const serviceTarget = `gui/${userId}/${label}`;
const { stdout: standardOutputPath, stderr: standardErrorPath } = watcherLogPaths(runtimeRoot);
const watchScript = path.join(docShelfRoot, 'scripts', 'watch.mjs');
const host = process.env.DOCSHELF_HOST || '127.0.0.1';
const port = Number(process.env.DOCSHELF_PORT || 4321);

if (process.platform !== 'darwin' || userId === undefined) {
  throw new Error('The DocShelf launchd integration requires macOS user launch agents.');
}

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('DOCSHELF_PORT must be an integer between 1 and 65535.');
}

if (userHome === '/' || path.dirname(launchAgentsDirectory) !== path.join(userHome, 'Library')) {
  throw new Error('Could not resolve a safe user LaunchAgents directory.');
}

switch (command) {
  case 'install':
    await install();
    break;
  case 'status':
    await status();
    break;
  case 'uninstall':
    await uninstall();
    break;
  default:
    console.error('Usage: node scripts/launchd.mjs <install|status|uninstall>');
    process.exitCode = 1;
}

async function install() {
  await mkdir(launchAgentsDirectory, { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });

  const previousPlist = await readFile(plistPath, 'utf8').catch(() => null);
  const wasLoaded = await isLoaded();
  await assertNoForeignWatcher();

  if (wasLoaded) {
    await launchctl(['bootout', `gui/${userId}`, plistPath]);
    await waitUntilUnloaded();
  }

  const temporaryPlistPath = `${plistPath}.${process.pid}.tmp`;
  await writeFile(temporaryPlistPath, renderPlist(), { mode: 0o644 });
  await rename(temporaryPlistPath, plistPath);

  try {
    await bootstrap();
  } catch (error) {
    if (previousPlist === null) {
      await unlink(plistPath).catch(() => {});
    } else {
      await writeFile(plistPath, previousPlist, { mode: 0o644 });
      if (wasLoaded) {
        await bootstrap().catch(() => {});
      }
    }
    throw error;
  }

  await confirmWatcherStarted();
  console.log(`Installed and started ${label}.`);
  console.log(`DocShelf: http://${browserHost(host)}:${port}/`);
  console.log(`Agent: ${plistPath}`);
  console.log(`Logs: ${standardOutputPath}`);
  console.log(`      ${standardErrorPath}`);
}

async function status() {
  const result = await run('/bin/launchctl', ['print', serviceTarget], true);
  if (result.code !== 0) {
    console.log(`${label} is not loaded.`);
    console.log(`Expected agent: ${plistPath}`);
    return;
  }

  process.stdout.write(result.stdout);
  const installedHost = launchctlEnvironmentValue(result.stdout, 'DOCSHELF_HOST') || host;
  const installedPort = launchctlEnvironmentValue(result.stdout, 'DOCSHELF_PORT') || String(port);
  console.log(`\nDocShelf: http://${browserHost(installedHost)}:${installedPort}/`);
  console.log(`Agent: ${plistPath}`);
  console.log(`Logs: ${standardOutputPath}`);
  console.log(`      ${standardErrorPath}`);
}

function launchctlEnvironmentValue(output, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return output.match(new RegExp(`^[\\t ]*${escapedKey}[\\t ]*=>[\\t ]*(.+?)[\\t ]*$`, 'm'))?.[1];
}

async function uninstall() {
  if (await isLoaded()) {
    await launchctl(['bootout', `gui/${userId}`, plistPath]);
    await waitUntilUnloaded();
  }
  await unlink(plistPath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  console.log(`Uninstalled ${label}. Runtime builds and logs were left in ${runtimeRoot}.`);
}

async function isLoaded() {
  return (await agentState()).loaded;
}

/**
 * Refuse to install over a watcher that launchd does not manage: the agent would fail the watcher
 * lock and KeepAlive would relaunch it every ThrottleInterval, appending to the error log forever.
 */
async function assertNoForeignWatcher() {
  const lock = await inspectWatcherLock(runtimeRoot);
  if (lock.state !== 'live') return;
  if (await ownsLock(lock)) return;
  throw new Error(
    `A DocShelf watcher is already running outside launchd (PID ${lock.owner.pid}). Stop it before ` +
      `installing the agent; otherwise the agent cannot take ${watcherLockPath(runtimeRoot)} and ` +
      'launchd relaunches it every 10 seconds.',
  );
}

/** Wait until the freshly bootstrapped agent holds the watcher lock, or report why it did not. */
async function confirmWatcherStarted() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const lock = await inspectWatcherLock(runtimeRoot);
    if (lock.state === 'live' && (await ownsLock(lock))) return;

    const agent = await agentState();
    if (agent.lastExitCode !== null && agent.lastExitCode !== 0) {
      throw new Error(
        `${label} is installed, but its watcher exited with code ${agent.lastExitCode} and launchd ` +
          `keeps relaunching it. Check ${standardErrorPath}, then fix the cause or run ` +
          '`npm run daemon:uninstall`.',
      );
    }
    await delay(250);
  }

  throw new Error(
    `${label} is installed, but its watcher did not take ${watcherLockPath(runtimeRoot)} within ` +
      `20 seconds. Check ${standardErrorPath} or run \`npm run daemon:status\`.`,
  );
}

/** @param {{ owner: { pid: number, launchdService: string | null } }} lock */
async function ownsLock(lock) {
  if (lock.owner.launchdService === label) return true;
  const agent = await agentState();
  return agent.pid !== null && agent.pid === lock.owner.pid;
}

async function agentState() {
  const result = await run('/bin/launchctl', ['print', serviceTarget], true);
  if (result.code !== 0) return { loaded: false, pid: null, lastExitCode: null };
  const pid = Number(launchctlProperty(result.stdout, 'pid'));
  const lastExitCode = launchctlProperty(result.stdout, 'last exit code');
  return {
    loaded: true,
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    lastExitCode: /^\d+$/.test(lastExitCode ?? '') ? Number(lastExitCode) : null,
  };
}

function launchctlProperty(output, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return output.match(new RegExp(`^[\\t ]*${escapedKey}[\\t ]*=[\\t ]*(.+?)[\\t ]*$`, 'm'))?.[1];
}

async function launchctl(arguments_) {
  const result = await run('/bin/launchctl', arguments_, true);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `launchctl exited with code ${result.code}.`);
  }
}

async function bootstrap() {
  let lastError = '';

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = await run('/bin/launchctl', ['bootstrap', `gui/${userId}`, plistPath], true);
    if (result.code === 0) return;

    lastError = result.stderr.trim() || `launchctl exited with code ${result.code}.`;
    if (!lastError.includes('Bootstrap failed: 5:')) break;
    await delay(250);
  }

  throw new Error(lastError);
}

async function waitUntilUnloaded() {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    if (!(await isLoaded())) {
      await delay(250);
      return;
    }
    await delay(100);
  }

  throw new Error(`${label} did not finish unloading.`);
}

function run(executable, arguments_, capture) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';

    if (capture) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
    }

    child.once('error', reject);
    child.once('exit', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * The agent runs at standard priority. As a `Background` process type it and the Astro builds it
 * spawns are confined to efficiency cores with throttled I/O, which made every rebuild take five
 * to six seconds instead of one. The watcher idles between rebuilds, so nothing is gained by
 * demoting it.
 */
const processType = 'Standard';

function renderPlist() {
  const executableDirectory = path.dirname(process.execPath);
  const executablePath = [
    executableDirectory,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].join(':');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(watchScript)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(docShelfRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DOCSHELF_HOST</key>
    <string>${xml(host)}</string>
    <key>DOCSHELF_PORT</key>
    <string>${port}</string>
    <key>PATH</key>
    <string>${xml(executablePath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>${processType}</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(standardOutputPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(standardErrorPath)}</string>
</dict>
</plist>
`;
}

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
