import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { loadCatalog } from '../src/core/catalog';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { DocumentServer } from '../src/core/server';

test('loopback server serves only registered documents/assets and rejects request attacks', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'docshelf-server-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'docs'));
  const document = path.join(root, 'docs', 'report.html');
  await writeFile(document, '<h1>Report</h1><script>window.works=true</script><img src="mark.svg"><a href="note.md#L2" target="_blank">note</a>');
  await writeFile(path.join(root, 'docs', 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(path.join(root, 'docs', 'private.json'), '{"secret":true}');
  await writeFile(path.join(root, 'docs', 'note.md'), '# Note\ntext');
  await writeFile(path.join(root, 'docs', 'other.html'), '<p>Private report</p>');
  const shelf = path.join(root, 'shelf.json');
  await writeFile(shelf, JSON.stringify({ version: 1, artifacts: [
    { project: 'Demo', title: 'Report', description: 'Interactive report', source: 'docs/report.html', route: 'demo/report.html', assets: ['mark.svg'] },
    { project: 'Demo', title: 'Note', description: 'A note', source: 'docs/note.md', route: 'demo/note.html' },
    { project: 'Demo', title: 'Other', source: 'docs/other.html', route: 'demo/other.html', assets: ['private.json'] },
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
  assert.doesNotMatch(html, /target=/);
  const ownToken = new URL(url).pathname.split('/')[1];
  const other = catalog.artifacts[2];
  const otherUrl = server.documentUrl(other);
  assert.equal((await fetch(otherUrl)).status, 200);
  const borrowed = new URL(otherUrl);
  borrowed.pathname = borrowed.pathname.replace(borrowed.pathname.split('/')[1], ownToken);
  assert.equal((await fetch(borrowed)).status, 404, 'One report cannot use its token to read another report.');
  borrowed.pathname = borrowed.pathname.replace('other.html', 'private.json');
  assert.equal((await fetch(borrowed)).status, 404, 'Assets use the same document-specific boundary.');
  const navigation = server.navigationUrl(other, '#section');
  assert.equal(server.navigationTarget(navigation)?.artifact.id, other.id);
  assert.equal((await fetch(navigation)).status, 200);
  assert.equal((await fetch(navigation)).headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal((await fetch(navigation.replace(`/open/${other.id}`, `/d/${other.id}/other.html`))).status, 404, 'Navigation capabilities never grant document reads.');
  assert.equal(server.navigationTarget(otherUrl.replace(`/d/${other.id}/other.html`, `/open/${other.id}`)), null, 'Read capabilities do not authorize navigation.');
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

test('served report elements carry the source lines Source view shows', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'docshelf-lines-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'report.html'), [
    '<!doctype html>',
    '<title>Report</title>',
    '<h1 data-docshelf-lines="1-99">Heading</h1>',
    '<p>First',
    'paragraph',
    '<p>Second <strong>bold</strong>\r',
    '<ul>',
    '  <li>one',
    '  <li>two',
    '</ul>',
  ].join('\n'));
  await writeFile(path.join(root, 'shelf.json'), JSON.stringify({ version: 1, artifacts: [{ project: 'Demo', title: 'Report', source: 'report.html', route: 'demo/report.html' }] }));
  const catalog = await loadCatalog(path.join(root, 'shelf.json'), root);
  const server = new DocumentServer();
  t.after(() => server.close());
  server.setCatalog(catalog); await server.start();
  const spans: string[] = [];
  const visit = (node: DefaultTreeAdapterTypes.Node) => {
    const value = 'attrs' in node ? node.attrs.find(attr => attr.name === 'data-docshelf-lines')?.value : undefined;
    if (value) spans.push(`${(node as DefaultTreeAdapterTypes.Element).tagName} ${value}`);
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  visit(parse(await (await fetch(server.documentUrl(catalog.artifacts[0]))).text()));
  // Implied end tags end on their last content line; head elements are not rendered.
  assert.deepEqual(spans, ['h1 3-3', 'p 4-5', 'p 6-6', 'strong 6-6', 'ul 7-10', 'li 8-8', 'li 9-9']);
});
