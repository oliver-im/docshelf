import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { checkBackendPort, initializeShelf, parseProxyStatus, portlessEnvironment, setupLocal, shelfRoute, verifyInstallation } from '../scripts/local-setup.mjs';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

const root = path.resolve(import.meta.dirname, '..');
const proxyStatus = (overrides = {}) => {
  const values = { installed: 'yes', running: 'responding', manager: 'running', port: 443, https: 'yes', lan: 'no', tlds: '.localhost', ...overrides };
  return `portless service\n  Manager state: ${values.manager}\n  Installed: ${values.installed}\n  Proxy on ${values.port}: ${values.running}\n  HTTPS: ${values.https}\n  TLDs: ${values.tlds}\n  LAN mode: ${values.lan}\n`;
};

async function fixture(t, options = {}) {
  const directory = await temporaryDirectory(t, path.join(root, '.docshelf-runtime'), 'setup-test-');
  await mkdir(path.join(directory, '.github'));
  await writeFile(path.join(directory, '.github/pages-shelf.json'), '{"version":1,"artifacts":[]}');
  const calls = [];
  const approvals = [];
  let installed = !options.fresh;
  let available = !options.missing;
  let registered = !options.fresh;
  const dependencies = {
    log: () => {}, checkPort: async () => {}, checkProxyPorts: async () => {}, resolves: async () => {},
    verify: async (value) => calls.push(['verify', value]),
    confirm: async (message) => { approvals.push(message); return options.approve !== false; },
    run: async (executable, args, commandOptions) => {
      calls.push([executable, args, commandOptions]);
      const success = (stdout = '') => ({ code: 0, stdout, stderr: '' });
      if (executable === 'npm') { available = true; return success(); }
      if (executable !== 'portless') return success();
      if (!available) throw Object.assign(new Error('not installed'), { code: 'ENOENT' });
      if (args[0] === '--version') return success('0.15.6\n');
      if (args.join(' ') === 'service status') return success(options.status || proxyStatus(installed ? {} : { installed: 'no', manager: 'not installed', running: 'not responding' }));
      if (args[0] === 'service' && args[1] === 'install') { installed = true; return success(); }
      if (args[0] === 'doctor') return success('ok    Local CA is trusted by the OS trust store.');
      if (args[0] === 'list') return success(options.routes || (registered ? '  https://shelf.localhost  ->  localhost:4321  (alias)\n' : 'No active routes.'));
      if (args[0] === 'alias') { registered = true; return success(); }
      if (args[0] === 'get') return success('https://shelf.localhost\n');
      throw new Error(`Unexpected command: ${args}`);
    },
  };
  return { directory, calls, approvals, dependencies, input: { root: directory, platform: 'darwin', env: {} } };
}

test('setup reuses trusted HTTPS and a matching static alias without privileged commands', async (t) => {
  const f = await fixture(t);
  const entries = '{"version":1,"artifacts":[{"source":"private.md"}]}';
  await writeFile(path.join(f.directory, 'shelf.local.json'), entries);
  assert.deepEqual(await setupLocal(f.input, f.dependencies), { site: 'https://shelf.localhost', port: 4321 });
  assert.equal(await readFile(path.join(f.directory, 'shelf.local.json'), 'utf8'), entries);
  assert.equal(f.approvals.length, 0);
  assert.ok(!f.calls.some(([exe, args]) => exe === 'portless' && ['trust', 'alias', 'install'].some((value) => args.includes(value))));
  const install = f.calls.find(([exe, args]) => exe === process.execPath && args.at(-1) === 'install');
  assert.deepEqual(f.calls[0][1], ['scripts/launchd.mjs', 'preflight']);
  assert.deepEqual(install[1], ['scripts/launchd.mjs', 'install']);
  assert.equal(install[2].env.DOCSHELF_SITE, 'https://shelf.localhost');
  assert.equal(install[2].env.DOCSHELF_HOST, '127.0.0.1');
  assert.equal(f.calls.at(-1)[0], 'verify');
});

test('unsupported platforms stop before initializing a shelf or running setup commands', async (t) => {
  const f = await fixture(t);
  for (const platform of ['linux', 'win32']) {
    await assert.rejects(setupLocal({ ...f.input, platform }, f.dependencies), /requires macOS.*npm run watch/);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.approvals.length, 0);
  await assert.rejects(readFile(path.join(f.directory, 'shelf.local.json')), { code: 'ENOENT' });
});

test('fresh setup approves global installation and certificate/service setup before running them', async (t) => {
  const f = await fixture(t, { fresh: true, missing: true });
  await setupLocal(f.input, f.dependencies);
  assert.equal(f.approvals.length, 2);
  assert.match(f.approvals[0], /globally from npm/);
  assert.match(f.approvals[1], /certificate authority.*administrator password/);
  assert.deepEqual(f.calls.find(([exe]) => exe === 'npm')[1], ['install', '--global', 'portless@0.15.6']);
  assert.deepEqual(f.calls.find(([exe, args]) => exe === 'portless' && args[0] === 'alias')[1], ['alias', 'shelf', '4321']);
  assert.ok(!f.calls.some(([, args]) => Array.isArray(args) && args.includes('--force')));
  assert.equal(await readFile(path.join(f.directory, 'shelf.local.json'), 'utf8'), '{"version":1,"artifacts":[]}');
});

test('declining privilege setup leaves the proxy, route, and watcher service alone', async (t) => {
  const f = await fixture(t, { fresh: true, approve: false });
  await assert.rejects(setupLocal(f.input, f.dependencies), /--direct/);
  assert.ok(!f.calls.some(([, args]) => Array.isArray(args) && args.includes('install')));
  assert.ok(!f.calls.some(([exe, args]) => exe === 'portless' && args[0] === 'alias'));
});

test('a conflicting alias is refused before any proxy or watcher change', async (t) => {
  const f = await fixture(t, { routes: '  https://shelf.localhost  ->  localhost:5000  (alias)' });
  await assert.rejects(setupLocal(f.input, f.dependencies), /another Portless route/);
  assert.equal(f.approvals.length, 0);
  assert.ok(!f.calls.some(([, args]) => Array.isArray(args) && args.includes('install')));
});

test('setup refuses incompatible shared proxy configuration and unreadable status', async (t) => {
  for (const settings of [{ lan: 'yes' }, { port: 8443 }, { https: 'no' }, { tlds: '.test' }]) {
    const f = await fixture(t, { status: proxyStatus(settings) });
    await assert.rejects(setupLocal(f.input, f.dependencies), /will not change a shared proxy/);
    assert.equal(f.approvals.length, 0);
  }
  assert.throws(() => parseProxyStatus('new unsupported output'), /Could not read/);
});

test('direct setup skips Portless and preserves a legacy local shelf', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, 'artifacts.local.json'), 'legacy data');
  const result = await setupLocal({ ...f.input, direct: true, env: { DOCSHELF_PORT: '4350' } }, f.dependencies);
  assert.equal(result.site, 'http://shelf.localhost:4350');
  assert.ok(!f.calls.some(([exe]) => exe === 'portless'));
  await assert.rejects(readFile(path.join(f.directory, 'shelf.local.json')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(f.directory, 'artifacts.local.json'), 'utf8'), 'legacy data');
});

test('failed service preflight and backend conflicts stop setup before shared changes', async (t) => {
  const f = await fixture(t);
  f.dependencies.checkPort = async () => { throw new Error('backend port occupied'); };
  await assert.rejects(setupLocal(f.input, f.dependencies), /backend port occupied/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.approvals.length, 0);
  assert.ok(!f.calls.some(([exe]) => exe === 'portless'));
});

test('an unrelated server on the proxy ports prevents fresh service installation', async (t) => {
  const f = await fixture(t, { fresh: true });
  f.dependencies.checkProxyPorts = async () => { throw new Error('Port 443 is occupied'); };
  await assert.rejects(setupLocal(f.input, f.dependencies), /Port 443 is occupied/);
  assert.equal(f.approvals.length, 0);
  assert.ok(!f.calls.some(([, args]) => Array.isArray(args) && args.includes('install')));
});

test('setup does not claim success when the installed endpoint fails verification', async (t) => {
  const f = await fixture(t);
  const messages = [];
  f.dependencies.log = (value) => messages.push(value);
  f.dependencies.verify = async () => { throw new Error('certificate validation failed'); };
  await assert.rejects(setupLocal(f.input, f.dependencies), /certificate validation failed/);
  assert.ok(!messages.some((value) => value.includes('DocShelf is ready')));
});

test('proxy commands cannot inherit LAN, tunnel, wildcard, or disabled-HTTPS settings', () => {
  const env = portlessEnvironment({ PATH: '/bin', PORTLESS_LAN: '1', PORTLESS_FUNNEL: '1', PORTLESS_TAILSCALE: '1', PORTLESS_NGROK: '1', PORTLESS_WILDCARD: '1', PORTLESS_HTTPS: '0', PORTLESS: '0', PORTLESS_STATE_DIR: '/custom' });
  assert.equal(env.PORTLESS_LAN, '0');
  assert.equal(env.PORTLESS_HTTPS, '1');
  assert.equal(env.PORTLESS_STATE_DIR, '/custom');
  for (const key of ['PORTLESS_FUNNEL', 'PORTLESS_TAILSCALE', 'PORTLESS_NGROK', 'PORTLESS_WILDCARD', 'PORTLESS']) assert.equal(env[key], undefined);
});

test('route parsing does not mistake managed apps, alternate origins, or lookalike hosts for our alias', () => {
  for (const line of [
    'https://shelf.localhost -> localhost:4321 (PID 42)',
    'http://shelf.localhost -> localhost:4321 (alias)',
    'https://shelf.localhost:8443 -> localhost:4321 (alias)',
  ]) assert.throws(() => shelfRoute(line, 4321), /another Portless route/);
  assert.equal(shelfRoute('https://shelf.localhost.example.com -> localhost:4321 (alias)', 4321), 'missing');
});

test('concurrent shelf initialization never overwrites existing registrations', async (t) => {
  const f = await fixture(t);
  await Promise.all([initializeShelf(f.directory), initializeShelf(f.directory)]);
  assert.equal(await readFile(path.join(f.directory, 'shelf.local.json'), 'utf8'), '{"version":1,"artifacts":[]}');
});

test('backend probing refuses unrelated listeners and readiness checks match the local watcher instance', async (t) => {
  const f = await fixture(t);
  const runtime = path.join(f.directory, '.docshelf-runtime');
  await mkdir(runtime);
  const status = { version: 1, instanceId: 'expected-instance', state: 'ready' };
  await writeFile(path.join(runtime, 'build-status.json'), JSON.stringify(status));
  let served = status;
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(served)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  await assert.rejects(checkBackendPort({ runtime, port }), /Cannot use backend port/);
  await verifyInstallation({ runtime, port, direct: true }, { timeout: 50 });
  served = { ...status, instanceId: 'other-checkout' };
  await assert.rejects(verifyInstallation({ runtime, port, direct: true }, { timeout: 50 }), /readiness verification failed/);
});
