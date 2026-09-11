import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { loadCatalog } from '../src/core/catalog';
import { DocumentServer } from '../src/core/server';

test('loopback server serves only registered documents/assets and rejects request attacks', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'docshelf-server-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'docs'));
  const document = path.join(root, 'docs', 'report.html');
  await writeFile(document, '<h1>Report</h1><script>window.works=true</script><img src="mark.svg"><a href="note.md#L2">note</a>');
  await writeFile(path.join(root, 'docs', 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(path.join(root, 'docs', 'private.json'), '{"secret":true}');
  await writeFile(path.join(root, 'docs', 'note.md'), '# Note\ntext');
  const shelf = path.join(root, 'shelf.json');
  await writeFile(shelf, JSON.stringify({ version: 1, artifacts: [
    { project: 'Demo', title: 'Report', description: 'Interactive report', source: 'docs/report.html', route: 'demo/report.html', assets: ['mark.svg'] },
    { project: 'Demo', title: 'Note', description: 'A note', source: 'docs/note.md', route: 'demo/note.html' },
  ] }));
  const catalog = await loadCatalog(shelf, root);
  const server = new DocumentServer();
  t.after(() => server.close());
  server.setCatalog(catalog); await server.start();
  const url = server.documentUrl(catalog.artifacts[0]);
  const result = await fetch(url);
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-security-policy')!, /sandbox allow-scripts allow-same-origin/);
  assert.match(result.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  const html = await result.text();
  assert.match(html, /window.works=true/);
  assert.ok(html.includes(server.navigationUrl(catalog.artifacts[1], '#L2')));
  assert.equal((await fetch(server.assetUrl(catalog.artifacts[0], 'mark.svg'))).status, 200);
  assert.equal((await fetch(server.assetUrl(catalog.artifacts[0], 'private.json'))).status, 404);
  assert.equal((await fetch(server.origin + '/report.html')).status, 404);
  assert.equal((await fetch(url, { method: 'POST', body: 'write' })).status, 405);
  assert.equal((await fetch(url, { headers: { Origin: 'https://evil.example' } })).status, 403);
  const wrongHost = await new Promise<number>(resolve => http.get(url, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode!); }));
  assert.equal(wrongHost, 403);
  server.setCatalog(catalog, false);
  assert.match((await fetch(url)).headers.get('content-security-policy')!, /script-src 'none'/);
  server.setCatalog(null);
  assert.equal((await fetch(url)).status, 404);
});
