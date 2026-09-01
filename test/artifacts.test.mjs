import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { contentRevision, rewriteArtifactLinks } from '../scripts/artifact-html.mjs';
import {
  artifactSourcesMatch,
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

test('generated HTML rewrites only links to registered source artifacts', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const ideasPath = path.join(fixtureRoot, 'docs', 'ideas.md');
  const researchPath = path.join(fixtureRoot, 'docs', 'research', 'dialect.md');
  await mkdir(path.dirname(researchPath), { recursive: true });
  await writeFile(ideasPath, '# Ideas\n');
  await writeFile(researchPath, '# Dialect\n');

  const ideas = loadedArtifact(ideasPath, 'example/ideas.html', 'markdown');
  const research = loadedArtifact(researchPath, 'example/dialect.html', 'markdown');
  const html = await rewriteArtifactLinks(
    `<!doctype html><html><body>
      <a href="research/dialect.md?view=full#findings">Research</a>
      <a href="?view=compact">Current view</a>
      <a href="missing.md">Missing</a>
      <a href="#local">Local</a>
      <a href="https://example.com/report.md">External</a>
    </body></html>`,
    ideas,
    { version: 1, artifacts: [ideas, research] },
  );

  assert.match(
    html,
    /href="\/?\?artifact=example%2Fdialect\.html&amp;artifact-query=view%3Dfull#findings"/,
  );
  assert.match(html, /data-docshelf-artifact="example\/dialect\.html"/);
  assert.match(
    html,
    /href="\/?\?artifact=example%2Fideas\.html&amp;artifact-query=view%3Dcompact"/,
  );
  assert.match(html, /target="_top"/);
  assert.match(html, /href="missing\.md"/);
  assert.match(html, /href="#local"/);
  assert.match(html, /href="https:\/\/example\.com\/report\.md"/);
});

test('generated HTML preserves an explicit new-tab target', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const firstPath = path.join(fixtureRoot, 'first.html');
  const secondPath = path.join(fixtureRoot, 'second.html');
  await writeFile(firstPath, '<!doctype html><title>First</title>');
  await writeFile(secondPath, '<!doctype html><title>Second</title>');
  const first = loadedArtifact(firstPath, 'example/first.html', 'html');
  const second = loadedArtifact(secondPath, 'example/second.html', 'html');

  const html = await rewriteArtifactLinks(
    '<!doctype html><a href="second.html" target="_blank">Second</a>',
    first,
    { version: 1, artifacts: [first, second] },
  );

  assert.match(html, /target="_blank"/);
  assert.match(html, /data-docshelf-artifact="example\/second\.html"/);
});

test('content revisions change only when the generated contents change', () => {
  assert.equal(contentRevision('same'), contentRevision(Buffer.from('same')));
  assert.notEqual(contentRevision('before'), contentRevision('after'));
});

test('source revision validation detects a file changed after synchronization', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const sourcePath = path.join(fixtureRoot, 'report.html');
  await writeFile(sourcePath, '<!doctype html><title>Before</title>');
  const registered = loadedArtifact(sourcePath, 'example/report.html', 'html');
  const revisionState = {
    version: 1,
    revision: 'unused-in-source-validation',
    catalogRevision: 'unused-in-source-validation',
    artifacts: [
      {
        route: registered.route,
        revision: 'unused-in-source-validation',
        sourceRevision: contentRevision('<!doctype html><title>Before</title>'),
      },
    ],
  };

  assert.equal(
    await artifactSourcesMatch({ version: 1, artifacts: [registered] }, revisionState),
    true,
  );
  await writeFile(sourcePath, '<!doctype html><title>After</title>');
  assert.equal(
    await artifactSourcesMatch({ version: 1, artifacts: [registered] }, revisionState),
    false,
  );
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

function loadedArtifact(sourcePath, route, format) {
  return {
    project: 'Example',
    source: path.relative(docShelfRoot, sourcePath),
    route,
    title: route,
    description: 'An example artifact.',
    sourcePath,
    format,
  };
}

async function writeManifest(manifestPath, artifacts) {
  await writeFile(manifestPath, `${JSON.stringify({ version: 1, artifacts }, null, 2)}\n`);
}
