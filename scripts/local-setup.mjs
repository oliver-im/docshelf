import { constants } from 'node:fs';
import { copyFile, lstat, readFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect, createServer } from 'node:net';
import { getCACertificates } from 'node:tls';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runCommand } from './command.mjs';
import { inspectWatcherLock } from './watcher-lock.mjs';

export const cleanOrigin = 'https://shelf.localhost';
export const portlessVersion = '0.15.6';

/** Keep setup local even when the caller normally uses Portless for LAN or public sharing. */
export function portlessEnvironment(environment) {
  const env = Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !key.startsWith('PORTLESS_') || key === 'PORTLESS_STATE_DIR'));
  delete env.PORTLESS;
  delete env.FORCE_COLOR;
  return { ...env, NO_COLOR: '1', PORTLESS_PORT: '443', PORTLESS_HTTPS: '1', PORTLESS_LAN: '0',
    PORTLESS_TLD: 'localhost', PORTLESS_SYNC_HOSTS: '0' };
}

export function parseProxyStatus(output) {
  const field = (name) => output.match(new RegExp(`^\\s*${name}: (.+)$`, 'm'))?.[1].trim();
  const proxy = output.match(/^\s*Proxy on (\d+): (responding|not responding)$/m);
  if (!proxy || !['yes', 'no'].includes(field('Installed')) ||
      !['yes', 'no'].includes(field('HTTPS')) || !['yes', 'no'].includes(field('LAN mode')) ||
      !field('TLDs') || !field('Manager state')) {
    throw new Error('Could not read Portless service status. Run `portless service status` to diagnose it.');
  }
  return {
    installed: field('Installed') === 'yes', running: proxy[2] === 'responding',
    port: Number(proxy[1]), https: field('HTTPS') === 'yes', lan: field('LAN mode') === 'yes',
    tlds: field('TLDs').split(/,\s*/), manager: field('Manager state'),
  };
}

export function shelfRoute(output, port, { proxyRunning = true } = {}) {
  const lines = output.split('\n').filter((line) => /https?:\/\/shelf\.localhost(?=[:/\s])/.test(line));
  if (!lines.length) return 'missing';
  // With no listener, Portless may display an HTTPS alias as HTTP on port 443.
  const origin = proxyRunning ? 'https://shelf\\.localhost' : '(?:https://shelf\\.localhost|http://shelf\\.localhost:443)';
  if (lines.length === 1 && new RegExp(`^\\s*${origin}/?\\s+->\\s+localhost:${port}\\s+\\(alias\\)\\s*$`).test(lines[0])) {
    return 'existing';
  }
  throw new Error('shelf.localhost already belongs to another Portless route. Setup will not replace it. Inspect `portless list`, or use `npm run setup -- --direct`.');
}

export async function initializeShelf(root) {
  for (const name of ['shelf.local.json', 'artifacts.local.json']) {
    if (await lstat(path.join(root, name)).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    })) return;
  }
  try {
    await copyFile(path.join(root, '.github/pages-shelf.json'), path.join(root, 'shelf.local.json'), constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

/** Setup is injectable so tests never install services, trust certificates, or touch a real shelf. */
export async function setupLocal({ root, direct = false, platform = process.platform, env = process.env }, {
  run = runCommand, confirm, log = console.log, checkPort = checkBackendPort, checkProxyPorts = checkProxyListeners,
  verify = verifyInstallation, resolves = () => lookup('shelf.localhost'),
  wait = delay,
} = {}) {
  if (platform !== 'darwin') {
    throw new Error('Automatic setup requires macOS. Use `npm run watch` for the portable foreground server.');
  }
  if (env.DOCSHELF_HOST && env.DOCSHELF_HOST !== '127.0.0.1') {
    throw new Error('Setup requires DOCSHELF_HOST=127.0.0.1. Use `npm run watch` for a custom listening interface.');
  }
  if (env.DOCSHELF_BASE && env.DOCSHELF_BASE !== '/') {
    throw new Error('Local setup requires DOCSHELF_BASE=/; deployment prefixes belong to hosted builds.');
  }
  const port = Number(env.DOCSHELF_PORT || 4321);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('The DocShelf backend needs an unprivileged DOCSHELF_PORT between 1024 and 65535.');
  }
  const runtime = path.join(root, '.docshelf-runtime');
  const command = async (executable, args, options = {}) => {
    const result = await run(executable, args, { cwd: root, env, ...options });
    if (result.code !== 0) throw new Error(result.stderr?.trim() || `${executable} ${args.join(' ')} failed (exit ${result.code}).`);
    return result.stdout;
  };
  // Check the user's service manager before requesting any machine-wide setup.
  await command(process.execPath, ['scripts/launchd.mjs', 'preflight']);
  await checkPort({ runtime, port });
  await initializeShelf(root);
  const proxyEnv = portlessEnvironment(env);
  const portless = (args, interactive = false) => command('portless', args, { env: proxyEnv, interactive });
  const ask = async (message) => {
    if (!confirm || !(await confirm(message))) {
      throw new Error('Setup was not completed. Use `npm run setup -- --direct` to install with the direct-port address, or `npm run watch` to run in the foreground.');
    }
  };

  if (!direct) {
    let version;
    try { version = await portless(['--version']); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await ask(`Install Portless ${portlessVersion} globally from npm?`);
      await command('npm', ['install', '--global', `portless@${portlessVersion}`], { interactive: true });
      version = await portless(['--version']);
    }
    const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match || Number(match[1]) !== 0 || Number(match[2]) !== 15 || Number(match[3]) < 6) {
      throw new Error(`This installer supports Portless 0.15.6–0.15.x; found ${version.trim()}. Install portless@${portlessVersion}, or use --direct.`);
    }
    let proxy = parseProxyStatus(await portless(['service', 'status']));
    if ((proxy.installed || proxy.running) &&
        (proxy.port !== 443 || !proxy.https || proxy.lan || proxy.tlds[0] !== '.localhost')) {
      throw new Error('The existing Portless proxy is not loopback HTTPS on port 443 with .localhost names. Setup will not change a shared proxy. Use --direct or configure Portless separately.');
    }
    shelfRoute(await portless(['list']), port, { proxyRunning: proxy.running });
    if (!proxy.installed) {
      if (!proxy.running) await checkProxyPorts();
      await ask('Install the Portless startup service on loopback ports 80/443 and trust its local HTTPS certificate authority? Portless may request an administrator password. Other apps can reuse this proxy.');
      await portless(['service', 'install', '--https', '--port', '443', '--tld', 'localhost'], true);
      // launchctl can return before the new proxy has opened its listener.
      for (let attempt = 0; attempt < 21; attempt += 1) {
        if (attempt > 0) await wait(250);
        proxy = parseProxyStatus(await portless(['service', 'status']));
        if (proxy.installed && proxy.running && proxy.manager === 'running') break;
      }
    }
    if (!proxy.installed || !proxy.running || proxy.manager !== 'running') {
      throw new Error('Portless is installed but its startup service is not running. Check `portless service status`; setup will not replace it.');
    }
    if (proxy.port !== 443 || !proxy.https || proxy.lan || proxy.tlds[0] !== '.localhost') {
      throw new Error('The installed proxy does not provide loopback HTTPS on port 443 with .localhost names. Inspect portless service status.');
    }
    const doctor = await run('portless', ['doctor'], { cwd: root, env: proxyEnv });
    if (!doctor.stdout.includes('Local CA is trusted by the OS trust store.') &&
        !doctor.stdout.includes('Proxy is configured with a custom TLS certificate.')) {
      await ask('Trust the existing Portless local certificate authority in the OS trust store? This may request an administrator password.');
      await portless(['trust'], true);
    }
    // Portless aliases can overwrite other static aliases even without --force.
    // Recheck immediately before registration, and leave an identical route untouched.
    if (shelfRoute(await portless(['list']), port) === 'missing') {
      await portless(['alias', 'shelf', String(port)]);
    } else {
      log('Reusing the existing shelf.localhost route and Portless startup service.');
    }
    if (await portless(['get', 'shelf', '--no-worktree']).then((value) => value.trim()) !== cleanOrigin) {
      throw new Error('Portless did not resolve shelf to https://shelf.localhost. Check `portless list`; setup will not alter the shared proxy configuration.');
    }
    try { await resolves(); } catch {
      await ask('Add Portless’s registered local hostnames to /etc/hosts so Safari and the system resolver can open them? This may request an administrator password.');
      await portless(['hosts', 'sync'], true);
    }
  }

  const site = direct ? `http://shelf.localhost:${port}` : cleanOrigin;
  await command(process.execPath, ['scripts/launchd.mjs', 'install'], {
    env: { ...env, DOCSHELF_HOST: '127.0.0.1', DOCSHELF_PORT: String(port), DOCSHELF_SITE: site },
    interactive: true,
  });
  log('Waiting for the first successful build…');
  await verify({ runtime, port, site, direct });
  log(`DocShelf is ready: ${site}/`);
  if (!direct) log(`Direct fallback: http://127.0.0.1:${port}/`);
  log('DocShelf will start automatically when you log in.');
  return { site, port };
}

export async function checkProxyListeners() {
  for (const port of [80, 443]) {
    for (const host of ['127.0.0.1', '::1']) {
      const occupied = await new Promise((resolve, reject) => {
        const socket = connect({ host, port });
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', (error) => {
          if (['ECONNREFUSED', 'EAFNOSUPPORT', 'EADDRNOTAVAIL', 'ENETUNREACH'].includes(error.code)) resolve(false);
          else reject(error);
        });
        socket.setTimeout(1_000, () => socket.destroy(new Error(`Could not check loopback port ${port}.`)));
      });
      if (occupied) throw new Error(`Port ${port} is already occupied by a service that Portless did not recognize. Setup will not replace it. Use --direct or configure your existing proxy separately.`);
    }
  }
}

export async function checkBackendPort({ runtime, port }) {
  try {
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve));
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      try {
        const lock = await inspectWatcherLock(runtime);
        const expected = JSON.parse(await readFile(path.join(runtime, 'build-status.json'), 'utf8'));
        const served = await readStatus(`http://127.0.0.1:${port}`);
        if (lock.state === 'live' && served.instanceId === expected.instanceId) return;
      } catch { /* A different service must not be replaced. */ }
    }
    throw new Error(`Cannot use backend port ${port}: ${error.message}. Choose a free DOCSHELF_PORT and rerun setup.`);
  }
}

/** Verify the exact watcher instance through both URLs, without disabling TLS validation. */
export async function verifyInstallation({ runtime, port, site, direct }, { timeout = 120_000 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const expected = JSON.parse(await readFile(path.join(runtime, 'build-status.json'), 'utf8'));
      const backend = await readStatus(`http://127.0.0.1:${port}`);
      if (expected.state === 'failed') throw new Error(`DocShelf build failed: ${expected.error?.message}`);
      const served = direct ? backend : await readStatus(site);
      if (expected.state === 'ready' && backend.state === 'ready' && served.state === 'ready' &&
          expected.instanceId === backend.instanceId && expected.instanceId === served.instanceId) return;
      lastError = new Error('The new watcher has not published a successful build through the installed address yet.');
    } catch (error) {
      lastError = error;
      if (error.message.startsWith('DocShelf build failed:')) throw error;
    }
    await delay(500);
  }
  throw new Error(`The service was installed, but readiness verification failed: ${lastError?.message}. Check npm run daemon:status.`);
}

function readStatus(origin) {
  const url = new URL('/__docshelf/status', origin);
  const secure = url.protocol === 'https:';
  return new Promise((resolve, reject) => {
    const request = (secure ? httpsRequest : httpRequest)(url, {
      // The hostname is for Host/SNI only. All readiness probes remain on loopback.
      lookup: (_hostname, _options, callback) => callback(null, '127.0.0.1', 4),
      family: 4,
      ...(secure ? { ca: [...getCACertificates('default'), ...getCACertificates('system')] } : {}),
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 32_768) response.destroy(new Error('Unexpectedly large status response.'));
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error(`${url.origin} returned HTTP ${response.statusCode}.`);
          const status = JSON.parse(body);
          if (status.version !== 1 || typeof status.instanceId !== 'string') throw new Error('The address did not return a DocShelf watcher status.');
          resolve(status);
        } catch (error) { reject(error); }
      });
    });
    request.setTimeout(5_000, () => request.destroy(new Error(`${url.origin} timed out.`)));
    request.on('error', reject);
    request.end();
  });
}
