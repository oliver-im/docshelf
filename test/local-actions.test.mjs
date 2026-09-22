import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { docShelfRoot } from '../scripts/artifacts.mjs';
import { createLocalActionsHandler } from '../scripts/local-actions.mjs';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'docshelf-actions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspaceRoot = path.join(directory, 'workspace');
  await mkdir(workspaceRoot);
  const sourcePath = path.join(workspaceRoot, 'a report; $(echo untouched).md');
  await writeFile(sourcePath, '# Original source\n');
  const artifacts = [
    { route: 'project/report.html', format: 'markdown', sourcePath },
    { route: 'claude/report.html', format: 'claude' },
  ];
  const revealed = [];
  const handler = createLocalActionsHandler({
    listenHost: '127.0.0.1', platform: 'darwin', workspaceRoot,
    loadShelf: async () => ({ artifacts }),
    revealFile: async (file) => { revealed.push(file); },
    ...options,
  });
  const server = createServer(async (request, response) => {
    if (!(await handler(request, response, new URL(request.url, 'http://localhost').pathname))) {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const requestHeaders = { 'X-DocShelf-Request': 'document-actions' };
  const capabilityResponse = await fetch(`${origin}/__docshelf/local-actions`, { headers: requestHeaders });
  const capability = await capabilityResponse.json();
  const headers = {
    ...requestHeaders,
    Origin: origin,
    'Content-Type': 'application/json',
    'X-DocShelf-Token': capability.token || '',
  };
  // Use the HTTP client so deliberately hostile Host/Fetch Metadata headers are not rewritten by fetch.
  const reveal = (body = { route: artifacts[0].route }, extra = {}) => new Promise((resolve, reject) => {
    const request = httpRequest(`${origin}/__docshelf/reveal`, {
      method: 'POST', headers, ...extra,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, text: async () => text, json: async () => JSON.parse(text) });
      });
    });
    request.on('error', reject);
    request.end(extra.body ?? JSON.stringify(body));
  });
  return { directory, workspaceRoot, sourcePath, artifacts, revealed, origin, headers, reveal, capability, capabilityResponse };
}

test('local reveal resolves the registered original and capabilities expose no paths', async (t) => {
  const f = await fixture(t);
  assert.equal(f.capabilityResponse.status, 200);
  assert.equal(f.capabilityResponse.headers.get('cache-control'), 'no-store');
  assert.equal(f.capability.revealInFinder, true);
  assert.deepEqual(Object.keys(f.capability).sort(), ['revealInFinder', 'token']);
  const response = await f.reveal();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revealed: true });
  // macOS /var is a symlink; compare resolved paths without assuming a temp-root spelling.
  const { realpath } = await import('node:fs/promises');
  assert.deepEqual(f.revealed, [await realpath(f.sourcePath)]);
});

test('reveal rejects cross-origin, stale-token, simple-form, and GET requests', async (t) => {
  const f = await fixture(t);
  for (const headers of [
    { ...f.headers, Origin: 'https://unrelated.example' },
    { ...f.headers, Origin: 'null' },
    { ...f.headers, Origin: '' },
    { ...f.headers, 'X-DocShelf-Token': 'old-watcher-token' },
    { ...f.headers, 'Content-Type': 'text/plain' },
    { ...f.headers, 'X-DocShelf-Request': '' },
    { ...f.headers, 'Sec-Fetch-Site': 'cross-site' },
    { ...f.headers, Host: 'unrelated.example' },
    { ...f.headers, 'X-Forwarded-For': '192.168.1.10, 127.0.0.1' },
  ]) assert.equal((await f.reveal(undefined, { headers })).status, 403);
  assert.equal((await fetch(`${f.origin}/__docshelf/reveal`, { headers: f.headers })).status, 405);
  assert.equal((await fetch(`${f.origin}/__docshelf/local-actions`)).status, 403);
  assert.equal((await fetch(`${f.origin}/__docshelf/local-actions`, { method: 'OPTIONS', headers: f.headers })).status, 405);
  assert.deepEqual(f.revealed, []);
});

test('reveal is unavailable on unsupported platforms or non-loopback listeners', async (t) => {
  const linux = await fixture(t, { platform: 'linux' });
  assert.deepEqual(linux.capability, { revealInFinder: false });
  assert.equal((await linux.reveal()).status, 404);
  const network = await fixture(t, { listenHost: '0.0.0.0' });
  assert.equal(network.capabilityResponse.status, 403);
  assert.equal((await network.reveal()).status, 403);
});

test('a local HTTPS proxy can retain its original host and origin', async (t) => {
  const f = await fixture(t);
  const response = await f.reveal(undefined, {
    headers: {
      ...f.headers, Host: 'shelf.localhost', Origin: 'https://shelf.localhost',
      'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-For': '::1, ::ffff:127.0.0.1',
    },
  });
  assert.equal(response.status, 200);
  assert.equal(f.revealed.length, 1);
});

test('reveal refuses paths, unknown routes, remote documents, and removed registrations', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.reveal({ route: f.sourcePath })).status, 404);
  assert.equal((await f.reveal({ route: '../../outside.html' })).status, 404);
  assert.equal((await f.reveal({ route: f.artifacts[0].route, path: f.sourcePath })).status, 400);
  assert.equal((await f.reveal({ route: 'claude/report.html' })).status, 400);
  f.artifacts.splice(0, 1);
  assert.equal((await f.reveal({ route: 'project/report.html' })).status, 404);
  assert.deepEqual(f.revealed, []);
});

test('reveal rechecks missing files and symlinks that leave the workspace', async (t) => {
  const f = await fixture(t);
  await rm(f.sourcePath);
  assert.equal((await f.reveal()).status, 409);
  const outside = path.join(f.directory, 'outside.md');
  await writeFile(outside, '# Outside\n');
  await symlink(outside, f.sourcePath);
  assert.equal((await f.reveal()).status, 409);
  assert.deepEqual(f.revealed, []);
});

test('reveal admits sources inside the DocShelf checkout when the workspace root excludes it', async (t) => {
  const f = await fixture(t);
  const checkoutDirectory = await temporaryDirectory(t, path.join(docShelfRoot, '.docshelf-runtime'), 'actions-');
  const sourcePath = path.join(checkoutDirectory, 'README.md');
  await writeFile(sourcePath, '# Inside the checkout\n');
  f.artifacts[0].sourcePath = sourcePath;
  assert.equal((await f.reveal()).status, 200);
  assert.deepEqual(f.revealed, [await realpath(sourcePath)]);
});

test('invalid bodies and OS failures return bounded errors without source paths', async (t) => {
  const f = await fixture(t, { revealFile: async () => { throw new Error('private /source/path'); } });
  assert.equal((await f.reveal(null)).status, 400);
  assert.equal((await f.reveal({}, { body: '{' })).status, 400);
  assert.equal((await f.reveal({ route: 'x'.repeat(5000) })).status, 413);
  const response = await f.reveal();
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private|source\/path/);
});

test('registration uses the same loopback, origin, and session protections as document actions', async t => {
  const calls = [];
  const f = await fixture(t, { platform: 'linux', registration: async body => { calls.push(body); return { revision: 'preview', documents: [], foldersAdded: 1 }; } });
  assert.equal(f.capability.add, true);
  assert.equal(f.capability.remove, true);
  assert.equal(typeof f.capability.token, 'string');
  const request = (headers, body = { action: 'preview', sources: ['docs'] }) => fetch(`${f.origin}/__docshelf/register`, { method: 'POST', headers, body: JSON.stringify(body) });
  for (const headers of [
    { ...f.headers, Origin: 'https://other.example' },
    { ...f.headers, 'X-DocShelf-Token': 'invalid' },
    { ...f.headers, 'Content-Type': 'text/plain' },
    { ...f.headers, 'X-DocShelf-Request': '' },
  ]) {
    assert.equal((await request(headers)).status, 403);
    assert.equal((await request(headers, { action: 'remove', route: 'project/report.html', revision: 'confirmation' })).status, 403);
  }
  assert.equal(calls.length, 0);
  assert.equal((await request(f.headers)).status, 200);
  assert.deepEqual(calls, [{ action: 'preview', sources: ['docs'] }]);
});
