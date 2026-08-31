import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  docShelfRoot,
  loadArtifactManifestFrom,
  validateRoute,
  validateSource,
} from '../scripts/artifacts.mjs';
import { renderMarkdownArtifact } from '../scripts/markdown.mjs';

test('route validation accepts a nested HTML route', () => {
  assert.doesNotThrow(() => validateRoute('project/report-v1.2.html', 0));
});

test('route validation rejects unsafe and ambiguous routes', () => {
  for (const route of [
    '/report.html',
    '../report.html',
    'project/../report.html',
    'project\\report.html',
    'project/report.htm',
    'Project/report.html',
  ]) {
    assert.throws(() => validateRoute(route, 0), { message: /route/ });
  }
});

test('source validation accepts relative HTML and Markdown paths', () => {
  assert.doesNotThrow(() => validateSource('../project/report.html', 0));
  assert.doesNotThrow(() => validateSource('../project/report.md', 0));
  assert.throws(() => validateSource('/project/report.html', 0), { message: /relative/ });
  assert.throws(() => validateSource('../project/report.txt', 0), {
    message: /HTML or Markdown file/,
  });
});

test('manifest loading resolves a valid source inside the workspace', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const sourcePath = path.join(fixtureRoot, 'report.html');
  const manifestPath = path.join(fixtureRoot, 'manifest.json');
  await writeFile(sourcePath, '<!doctype html><title>Report</title>');
  await writeManifest(manifestPath, [artifact(path.relative(docShelfRoot, sourcePath))]);

  const manifest = await loadArtifactManifestFrom(manifestPath);

  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].sourcePath, await realpath(sourcePath));
  assert.equal(manifest.artifacts[0].format, 'html');
});

test('manifest loading identifies a Markdown source', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const sourcePath = path.join(fixtureRoot, 'report.md');
  const manifestPath = path.join(fixtureRoot, 'manifest.json');
  await writeFile(sourcePath, '# Report\n');
  await writeManifest(manifestPath, [artifact(path.relative(docShelfRoot, sourcePath))]);

  const manifest = await loadArtifactManifestFrom(manifestPath);

  assert.equal(manifest.artifacts[0].format, 'markdown');
});

test('Markdown rendering creates a themed standalone document', async () => {
  const html = await renderMarkdownArtifact(
    {
      title: 'Research & notes',
      description: 'A <local> document.',
      sourcePath: '/workspace/research.md',
    },
    `---
lang: ko-KR
private: true
---
# Context window

- [x] Indexed

| Format | Status |
| --- | --- |
| Markdown | Ready |

\`\`\`js
const ready = true;
\`\`\`

<script>window.shouldNotRun = true;</script>
`,
  );

  assert.match(html, /<html lang="ko-KR">/);
  assert.match(html, /<title>Research &amp; notes<\/title>/);
  assert.match(html, /content="A &lt;local&gt; document\."/);
  assert.match(html, /href="\/markdown-tokyo-night\.css"/);
  assert.match(html, /<h1 id="context-window">Context window<\/h1>/);
  assert.match(html, /class="contains-task-list"/);
  assert.match(html, /<table>/);
  assert.match(html, /class="language-js"/);
  assert.doesNotMatch(html, /private: true/);
  assert.doesNotMatch(html, /shouldNotRun/);
});

test('manifest loading rejects duplicate routes', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const firstSource = path.join(fixtureRoot, 'first.html');
  const secondSource = path.join(fixtureRoot, 'second.html');
  const manifestPath = path.join(fixtureRoot, 'manifest.json');
  await writeFile(firstSource, '<!doctype html><title>First</title>');
  await writeFile(secondSource, '<!doctype html><title>Second</title>');
  await writeManifest(manifestPath, [
    artifact(path.relative(docShelfRoot, firstSource)),
    artifact(path.relative(docShelfRoot, secondSource)),
  ]);

  await assert.rejects(loadArtifactManifestFrom(manifestPath), { message: /duplicates route/ });
});

test('manifest loading rejects sources outside the workspace root', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const externalRoot = await mkdtemp(path.join(tmpdir(), 'docshelf-external-'));
  t.after(() => rm(externalRoot, { recursive: true, force: true }));
  const sourcePath = path.join(externalRoot, 'report.html');
  const manifestPath = path.join(fixtureRoot, 'manifest.json');
  await writeFile(sourcePath, '<!doctype html><title>Outside</title>');
  await writeManifest(manifestPath, [artifact(path.relative(docShelfRoot, sourcePath))]);

  await assert.rejects(loadArtifactManifestFrom(manifestPath), {
    message: /outside the workspace root \(the parent directory of DocShelf\)/,
  });
});

async function createDocShelfFixture(t) {
  const fixtureParent = path.join(docShelfRoot, '.docshelf-runtime');
  await mkdir(fixtureParent, { recursive: true });
  const fixtureRoot = await mkdtemp(path.join(fixtureParent, 'test-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  return fixtureRoot;
}

function artifact(source) {
  return {
    project: 'Example',
    source,
    route: 'example/report.html',
    title: 'Example report',
    description: 'An example artifact.',
  };
}

async function writeManifest(manifestPath, artifacts) {
  await writeFile(manifestPath, `${JSON.stringify({ version: 1, artifacts }, null, 2)}\n`);
}
