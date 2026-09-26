import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, unlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { documentLabel, loadCatalog } from '../src/core/catalog';
import { readBoundedFile } from '../src/core/files';
import { createPermalink, parseProtocol, parseRange, checkRange } from '../src/core/protocol';
import { renderMarkdown, sourceLines } from '../src/core/markdown';
import { extractText, ShelfSearch } from '../src/core/search';
import { parseGitHubMarkdownUrl } from '@docshelf/core/github-markdown';
import { parseClaudeArtifactUrl } from '@docshelf/core/claude-artifacts';

export async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'docshelf-unit-'));
  const workspace = path.join(root, 'workspace');
  const vault = path.join(root, 'vault');
  await mkdir(workspace); await mkdir(vault);
  const source = path.join(workspace, '문서 with spaces.md');
  await writeFile(source, '# Outside the vault\n\nDistinctive searchable phrase.\n');
  const shelfPath = path.join(vault, 'shelf.local.json');
  const entry = { project: 'Example', source, route: 'example/guide.html', title: 'Project guide', description: 'External guide' };
  await writeFile(shelfPath, JSON.stringify({ version: 1, artifacts: [entry] }));
  return { root, workspace, vault, source, shelfPath, entry, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('descriptions are optional and searchable while malformed values are rejected', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const search = new ShelfSearch();
  for (const description of [undefined, '', '   ', '  Curated metadata  ']) {
    await writeFile(f.shelfPath, JSON.stringify({ version: 1, artifacts: [{ ...f.entry, description }] }));
    const artifact = (await loadCatalog(f.shelfPath, f.workspace)).artifacts[0];
    assert.equal(artifact.description, description?.trim() || '');
    await search.replace([artifact], new Map([[artifact.id, '# Notes\nBodykeyword remains searchable.']]));
    assert.equal(search.search('')[0].excerpt, '');
    assert.equal(search.search('   ')[0].excerpt, '');
    assert.match(search.search('Bodykeyword')[0].excerpt, /Bodykeyword/);
    if (description?.trim()) assert.equal(search.search('Curated')[0].artifact.id, artifact.id);
    await search.replace([artifact], new Map());
    assert.equal(search.search('Project')[0].excerpt, description?.trim() || '');
  }
  for (const description of [null, 42, {}, [], 'x'.repeat(8193), 'bad\0text']) {
    await writeFile(f.shelfPath, JSON.stringify({ version: 1, artifacts: [{ ...f.entry, description }] }));
    await assert.rejects(loadCatalog(f.shelfPath, f.workspace), /description must be a string/);
  }
});

test('every source read revalidates a replaced symlink and enforces the byte limit', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const link = path.join(f.workspace, 'link.md');
  const outside = path.join(f.root, 'secret.md');
  const roots = [await realpath(f.workspace)];
  await writeFile(outside, 'private'); await symlink(f.source, link);
  assert.match((await readBoundedFile(link, roots, 100)).toString(), /Outside/);
  await assert.rejects(readBoundedFile(link, roots, 2), /limit/);
  await unlink(link); await symlink(outside, link);
  await assert.rejects(readBoundedFile(link, roots, 100), /outside/);
});

test('runtime catalogs retain unavailable files while validation and reads stay strict', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const missingSource = path.join(f.workspace, 'missing.md');
  const missingAsset = path.join(f.workspace, 'missing.svg');
  await writeFile(f.shelfPath, JSON.stringify({ version: 1, artifacts: [
    { ...f.entry, assets: ['missing.svg'] },
    { ...f.entry, source: missingSource, route: 'example/missing.html' },
  ] }));
  await assert.rejects(loadCatalog(f.shelfPath, f.workspace), { code: 'ENOENT' });
  const catalog = await loadCatalog(f.shelfPath, f.workspace, { allowUnavailableFiles: true });
  assert.equal(catalog.artifacts.length, 2);
  assert.deepEqual(catalog.artifacts[0].assets, ['missing.svg']);
  assert.equal(catalog.artifacts[1].sourcePath, missingSource);
  assert.equal(catalog.artifacts[1].canonicalPath, undefined);
  assert.match((await readBoundedFile(f.source, catalog.roots, 100)).toString(), /Outside the vault/);
  await assert.rejects(readBoundedFile(missingSource, catalog.roots, 100), { code: 'ENOENT' });

  await writeFile(missingSource, '# Restored');
  await writeFile(missingAsset, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const restored = await loadCatalog(f.shelfPath, f.workspace);
  assert.equal(restored.artifacts[1].id, catalog.artifacts[1].id);
  assert.equal(restored.artifacts[1].canonicalPath, await realpath(missingSource));

  const outside = path.join(f.root, 'secret.md');
  await writeFile(outside, 'private');
  await unlink(missingSource);
  await symlink(outside, missingSource);
  await assert.rejects(readBoundedFile(missingSource, catalog.roots, 100), /outside/);
  await assert.rejects(loadCatalog(f.shelfPath, f.workspace, { allowUnavailableFiles: true }), /outside/);
});

test('shelf rejects traversal, duplicate routes/sources, and invalid remote hosts', async t => {
  const f = await fixture(); t.after(f.cleanup);
  for (const entry of [{ ...f.entry, route: '../guide.html' }, { ...f.entry, source: 'https://example.com/doc.md' }, { ...f.entry, assets: ['../secret.txt'] }]) {
    await writeFile(f.shelfPath, JSON.stringify({ version: 1, artifacts: [entry] }));
    await assert.rejects(loadCatalog(f.shelfPath, f.workspace));
  }
  await writeFile(f.shelfPath, JSON.stringify({ version: 1, artifacts: [f.entry, f.entry] }));
  await assert.rejects(loadCatalog(f.shelfPath, f.workspace), /Duplicate/);
  for (const url of ['https://github.com.evil.test/a/b/blob/main/x.md', 'https://github.com/a/b/blob/main/x.html', 'https://user@github.com/a/b/blob/main/x.md', 'https://raw.githubusercontent.com/a/b/main/x.md?token=x']) assert.equal(parseGitHubMarkdownUrl(url), null);
  assert.equal(parseClaudeArtifactUrl('https://claude.ai/chat/test'), null);
  assert.ok(parseGitHubMarkdownUrl('https://github.com/owner/repo/blob/main/README.md'));
});

test('links use source and round trip Unicode, spaces and line ranges', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const artifact = (await loadCatalog(f.shelfPath, f.workspace)).artifacts[0];
  const url = new URL(createPermalink('Vault 한글', artifact, { start: 7, end: 11 }));
  assert.equal(url.searchParams.has('path'), false);
  assert.equal(url.searchParams.get('vault'), 'Vault 한글');
  assert.ok(url.href.includes('vault=Vault%20'));
  assert.equal(url.href.includes('+'), false);
  const hostDecoded = Object.fromEntries(url.search.slice(1).split('&').map(part => part.split('=').map(decodeURIComponent)));
  assert.equal(hostDecoded.source, f.source);
  assert.equal(hostDecoded.vault, 'Vault 한글');
  assert.deepEqual(parseProtocol(Object.fromEntries(url.searchParams)), { source: f.source, range: { start: 7, end: 11 } });
  for (const range of ['0', '-1', '7-3', '1-2-3', '9007199254740992', '2.5']) assert.throws(() => parseRange(range));
  assert.throws(() => parseProtocol({ source: f.source, path: f.source }));
  assert.throws(() => checkRange({ start: 1, end: 4 }, 3), /may have changed/);
});

test('Markdown preserves CRLF/frontmatter source offsets and omits raw HTML', () => {
  const source = '---\r\ntitle: Hidden\r\n---\r\n\r\n# Visible\r\n\r\nfirst  \r\nsecond\r\n\r\n<script>alert(1)</script>\r\n';
  const rendered = renderMarkdown(source);
  assert.equal(rendered.lineCount, 10);
  assert.match(rendered.html, /data-docshelf-line-start="5" data-docshelf-line-end="5"/);
  assert.match(rendered.html, /data-docshelf-line-break-after="7"/);
  assert.doesNotMatch(rendered.html, /<script|alert\(1\)|title: Hidden/);
  assert.equal(sourceLines('').length, 0);
  assert.equal(sourceLines('a\n\n').length, 2);
});

test('search includes document contents and excludes scripts and styles', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const artifact = (await loadCatalog(f.shelfPath, f.workspace)).artifacts[0];
  const search = new ShelfSearch();
  await search.replace([artifact], new Map([[artifact.id, '# Notes\n\nDistinctive zebracorn phrase.']]));
  assert.equal(search.search('zebracorn')[0].artifact.id, artifact.id);
  assert.equal(extractText('<body><h1>Visible</h1><script>secretjs</script><style>secretcss</style></body>'), 'Visible');
});

test('sidebar labels lead with filenames and keep only informative titles', () => {
  assert.deepEqual(documentLabel({ kind: 'markdown', source: '../project/README.md', title: 'DocShelf' }), { name: 'README.md', title: 'DocShelf' });
  assert.deepEqual(documentLabel({ kind: 'html', source: 'docs/project-review.html', title: 'Project review' }), { name: 'project-review.html', title: '' });
  assert.deepEqual(documentLabel({ kind: 'github', source: 'https://github.com/owner/repo/blob/main/docs/My%20Guide.md', title: 'Setup' }), { name: 'My Guide.md', title: 'Setup' });
  assert.deepEqual(documentLabel({ kind: 'claude', source: 'https://claude.ai/public/artifacts/00000000-0000-4000-8000-000000000000', title: 'Report' }), { name: 'Report', title: '' });
});
