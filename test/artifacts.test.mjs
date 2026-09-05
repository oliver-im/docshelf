import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  artifactViewerUrl,
  contentRevision,
  rewriteArtifactLinks,
} from '../scripts/artifact-html.mjs';
import {
  artifactFileName,
  artifactUrl,
  artifactSourcesMatch,
  docShelfRoot,
  loadShelf,
  loadShelfFrom,
  parseClaudeArtifactSource,
  validateRoute,
  validateSource,
} from '../scripts/artifacts.mjs';
import { renderMarkdownArtifact } from '../scripts/markdown.mjs';
import { normalizeBasePath, sitePath } from '../scripts/site-path.mjs';
import {
  createLineFragment,
  parseLineFragment,
} from '../src/lib/line-permalinks.js';
import { parseGitHubMarkdownUrl } from '../src/lib/github-markdown.js';
import { renderRemoteMarkdownContent } from '../src/lib/remote-markdown-content.js';
import {
  artifactsShareRemoteSource,
  remoteArtifactIdentity,
} from '../src/lib/artifact-identity.js';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

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

test('artifact filenames use the registered source basename', () => {
  assert.equal(
    artifactFileName({ source: '../example/docs/README.md' }),
    'README.md',
  );
});

test('Claude Artifact URLs accept only canonical public and embed links', () => {
  const artifactId = '12345678-90ab-cdef-1234-567890abcdef';
  const expected = {
    artifactId,
    publicUrl: `https://claude.ai/public/artifacts/${artifactId}`,
    embedUrl: `https://claude.ai/public/artifacts/${artifactId}/embed`,
  };

  assert.deepEqual(
    parseClaudeArtifactSource(`https://claude.ai/public/artifacts/${artifactId}`),
    expected,
  );
  assert.deepEqual(
    parseClaudeArtifactSource(`https://claude.ai/public/artifacts/${artifactId}/embed/`),
    expected,
  );

  for (const source of [
    'http://claude.ai/public/artifacts/12345678-90ab-cdef-1234-567890abcdef',
    'https://claude.ai/public/artifacts/not-an-id',
    'https://claude.ai/public/artifacts/12345678-90ab-cdef-1234-567890abcdef?view=1',
    'https://claude.ai/',
    'https://example.com/public/artifacts/12345678-90ab-cdef-1234-567890abcdef',
  ]) {
    assert.equal(parseClaudeArtifactSource(source), null);
  }
});

test('GitHub Markdown file URLs resolve to their raw source', () => {
  assert.deepEqual(
    parseGitHubMarkdownUrl(
      'https://github.com/oliver-im/docshelf/blob/main/docs/Guide.markdown#L12-L18',
    ),
    {
      sourceUrl: 'https://github.com/oliver-im/docshelf/blob/main/docs/Guide.markdown',
      rawUrl: 'https://raw.githubusercontent.com/oliver-im/docshelf/main/docs/Guide.markdown',
      linkBaseUrl: 'https://github.com/oliver-im/docshelf/blob/main/docs/Guide.markdown',
      owner: 'oliver-im',
      repository: 'docshelf',
      fileName: 'Guide.markdown',
    },
  );

  assert.deepEqual(
    parseGitHubMarkdownUrl(
      'https://raw.githubusercontent.com/oliver-im/docshelf/refs/heads/main/README.md',
    ),
    {
      sourceUrl:
        'https://raw.githubusercontent.com/oliver-im/docshelf/refs/heads/main/README.md',
      rawUrl:
        'https://raw.githubusercontent.com/oliver-im/docshelf/refs/heads/main/README.md',
      linkBaseUrl:
        'https://raw.githubusercontent.com/oliver-im/docshelf/refs/heads/main/README.md',
      owner: 'oliver-im',
      repository: 'docshelf',
      fileName: 'README.md',
    },
  );
});

test('GitHub Markdown imports reject general pages and ambiguous URLs', () => {
  for (const source of [
    'http://github.com/oliver-im/docshelf/blob/main/README.md',
    'https://github.com/oliver-im/docshelf',
    'https://github.com/oliver-im/docshelf/blob/main/index.html',
    'https://github.com/oliver-im/docshelf/blob/main/README.md?plain=1',
    'https://github.com/oliver-im/docshelf/blob/main/docs%2FREADME.md',
    'https://raw.githubusercontent.com/oliver-im/docshelf/main/index.html',
    'https://example.com/oliver-im/docshelf/blob/main/README.md',
  ]) {
    assert.equal(parseGitHubMarkdownUrl(source), null);
  }
});

test('browser-rendered Markdown retains selectable source ranges', () => {
  const source = `# Remote

Paragraph
continues

- one
- two

| A | B |
| - | - |
| 1 | 2 |

\`\`\`js
const ready = true;
\`\`\`

<script>window.shouldNotRun = true;</script>
`;
  const rendered = renderRemoteMarkdownContent(source);

  assert.equal(rendered.sourceLineCount, 17);
  assert.match(
    rendered.html,
    /<h1 data-docshelf-line-start="1" data-docshelf-line-end="1">Remote<\/h1>/,
  );
  assert.match(
    rendered.html,
    /<p data-docshelf-line-start="3" data-docshelf-line-end="4">Paragraph<br data-docshelf-line-break-after="3">continues<\/p>/,
  );
  assert.match(
    rendered.html,
    /<ul data-docshelf-line-start="6" data-docshelf-line-end="7">/,
  );
  assert.match(
    rendered.html,
    /<table data-docshelf-line-start="9" data-docshelf-line-end="11">/,
  );
  assert.match(
    rendered.html,
    /<pre data-docshelf-line-start="13" data-docshelf-line-end="15">/,
  );
  assert.doesNotMatch(rendered.html, /shouldNotRun/);
});

test('remote artifact identity deduplicates sources independently of their routes', () => {
  const embedUrl =
    'https://claude.ai/public/artifacts/12345678-90ab-cdef-1234-567890abcdef/embed';
  const hostedClaude = { route: 'team/demo.html', embedUrl };
  const importedClaude = {
    route: 'claude/12345678-90ab-cdef-1234-567890abcdef.html',
    embedUrl,
    sourceType: 'claude',
  };
  const rawUrl = 'https://raw.githubusercontent.com/oliver-im/docshelf/main/README.md';
  const importedMarkdown = {
    route: 'github/oliver-im/docshelf/readme.html',
    sourceType: 'github-markdown',
    rawUrl,
  };

  assert.equal(artifactsShareRemoteSource(hostedClaude, importedClaude), true);
  assert.equal(remoteArtifactIdentity(importedMarkdown), `github-markdown:${rawUrl}`);
  assert.equal(
    artifactsShareRemoteSource(importedMarkdown, {
      ...importedMarkdown,
      route: 'another/generated-route.html',
    }),
    true,
  );
  assert.equal(
    artifactsShareRemoteSource(hostedClaude, { ...importedClaude, embedUrl: `${embedUrl}?other` }),
    false,
  );
  assert.equal(remoteArtifactIdentity({ route: 'local/report.html' }), null);
});

test('shelf loading supports the legacy local filename and prefers the new name', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const localPath = path.join(fixtureRoot, 'shelf.local.json');
  const legacyPath = path.join(fixtureRoot, 'artifacts.local.json');
  const fallbackPath = path.join(fixtureRoot, 'shelf.json');
  const publicUrl =
    'https://claude.ai/public/artifacts/12345678-90ab-cdef-1234-567890abcdef';
  await writeShelf(fallbackPath, []);
  await writeShelf(legacyPath, [{ ...artifact(publicUrl), title: 'Legacy shelf' }]);

  const warnings = [];
  const legacyShelf = await loadShelf({
    localPath,
    legacyPath,
    fallbackPath,
    warn: (message) => warnings.push(message),
  });
  assert.equal(legacyShelf.artifacts[0].title, 'Legacy shelf');
  assert.deepEqual(warnings, [
    'DocShelf is loading deprecated artifacts.local.json. Rename it with: mv artifacts.local.json shelf.local.json',
  ]);

  await writeShelf(localPath, [{ ...artifact(publicUrl), title: 'Current shelf' }]);
  warnings.length = 0;
  const currentShelf = await loadShelf({
    localPath,
    legacyPath,
    fallbackPath,
    warn: (message) => warnings.push(message),
  });
  assert.equal(currentShelf.artifacts[0].title, 'Current shelf');
  assert.deepEqual(warnings, []);
});

test('shelf loading accepts a public Claude Artifact without a local file', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const shelfPath = path.join(fixtureRoot, 'shelf.json');
  const artifactId = '12345678-90ab-cdef-1234-567890abcdef';
  const source = `https://claude.ai/public/artifacts/${artifactId}/embed`;
  await writeShelf(shelfPath, [artifact(source)]);

  const shelf = await loadShelfFrom(shelfPath);
  const registered = shelf.artifacts[0];

  assert.equal(registered.source, `https://claude.ai/public/artifacts/${artifactId}`);
  assert.equal(registered.embedUrl, `https://claude.ai/public/artifacts/${artifactId}/embed`);
  assert.equal(registered.sourcePath, undefined);
  assert.equal(registered.format, 'claude');
  assert.equal(artifactFileName(registered), 'Example report');
  assert.equal(artifactUrl(registered), '/?artifact=example%2Freport.html');
});

test('shelf loading rejects arbitrary remote pages', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const shelfPath = path.join(fixtureRoot, 'shelf.json');
  await writeShelf(shelfPath, [artifact('https://claude.ai/')]);

  await assert.rejects(loadShelfFrom(shelfPath), {
    message: /must be a public Claude Artifact link/,
  });
});

test('shelf loading treats Claude share and embed forms as the same source', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const shelfPath = path.join(fixtureRoot, 'shelf.json');
  const publicUrl =
    'https://claude.ai/public/artifacts/12345678-90ab-cdef-1234-567890abcdef';
  await writeShelf(shelfPath, [
    artifact(publicUrl),
    { ...artifact(`${publicUrl}/embed`), route: 'example/second.html' },
  ]);

  await assert.rejects(loadShelfFrom(shelfPath), { message: /duplicates source/ });
});

test('shelf loading resolves a valid source inside the workspace', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const sourcePath = path.join(fixtureRoot, 'report.html');
  const shelfPath = path.join(fixtureRoot, 'shelf.json');
  await writeFile(sourcePath, '<!doctype html><title>Report</title>');
  await writeShelf(shelfPath, [artifact(path.relative(docShelfRoot, sourcePath))]);

  const shelf = await loadShelfFrom(shelfPath);

  assert.equal(shelf.artifacts.length, 1);
  assert.equal(shelf.artifacts[0].sourcePath, await realpath(sourcePath));
  assert.equal(shelf.artifacts[0].format, 'html');
});

test('shelf loading identifies a Markdown source', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const sourcePath = path.join(fixtureRoot, 'report.md');
  const shelfPath = path.join(fixtureRoot, 'shelf.json');
  await writeFile(sourcePath, '# Report\n');
  await writeShelf(shelfPath, [artifact(path.relative(docShelfRoot, sourcePath))]);

  const shelf = await loadShelfFrom(shelfPath);

  assert.equal(shelf.artifacts[0].format, 'markdown');
});

test('the Pages demo shelf publishes only the repository README', async () => {
  const shelf = await loadShelfFrom(
    path.join(docShelfRoot, '.github', 'pages-shelf.json'),
  );

  assert.equal(shelf.artifacts.length, 1);
  assert.equal(
    shelf.artifacts[0].sourcePath,
    await realpath(path.join(docShelfRoot, 'README.md')),
  );
  assert.equal(shelf.artifacts[0].route, 'docshelf/readme.html');
  assert.equal(shelf.artifacts[0].format, 'markdown');
});

test('Markdown rendering creates a themed standalone document', async () => {
  const expectedThemeSync = (
    await readFile(
      new URL('../.agents/skills/docshelf/assets/theme-sync.js', import.meta.url),
      'utf8',
    )
  ).trimEnd();
  const source = `---
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
`;
  const html = await renderMarkdownArtifact(
    {
      title: 'Research & notes',
      description: 'A <local> document.',
      sourcePath: '/workspace/research.md',
    },
    source,
  );

  assert.match(html, /<html lang="ko-KR">/);
  assert.doesNotMatch(html, /data-docshelf-source-revision/);
  assert.match(html, /<title>Research &amp; notes<\/title>/);
  assert.match(html, /content="A &lt;local&gt; document\."/);
  assert.match(html, /href="\/markdown-tokyo-night\.css"/);
  assert.match(html, /src="\/markdown-line-links\.js" defer/);
  assert.match(html, /data-docshelf-source-line-count="17"/);
  assert.equal(html.match(/<script>\n([\s\S]*?)\n    <\/script>/)?.[1], expectedThemeSync);
  assert.match(
    html,
    /<h1 data-docshelf-line-start="5" data-docshelf-line-end="5" id="context-window">/,
  );
  assert.match(
    html,
    /<li class="task-list-item" data-docshelf-line-start="7" data-docshelf-line-end="7">/,
  );
  assert.match(
    html,
    /<tr data-docshelf-line-start="11" data-docshelf-line-end="11">/,
  );
  assert.match(
    html,
    /<pre class="language-js" data-language="js" data-docshelf-line-start="13" data-docshelf-line-end="15">/,
  );
  assert.match(html, /class="contains-task-list"/);
  assert.match(html, /<table>/);
  assert.match(html, /class="language-js"/);
  assert.doesNotMatch(html, /src="\/mermaid\.min\.js"/);
  assert.doesNotMatch(html, /src="\/markdown-mermaid\.js"/);
  assert.doesNotMatch(html, /private: true/);
  assert.doesNotMatch(html, /shouldNotRun/);
});

test('Markdown rendering preserves soft and hard source-line breaks', async () => {
  const html = await renderMarkdownArtifact(
    {
      title: 'Line breaks',
      description: 'Source-aligned rendering.',
      sourcePath: '/workspace/line-breaks.md',
    },
    `---
title: Line breaks
---
alpha
beta *spans
lines*\\
gamma
`,
  );

  assert.match(
    html,
    /<p data-docshelf-line-start="4" data-docshelf-line-end="7">alpha<br data-docshelf-line-break-after="4">\n/,
  );
  assert.match(html, /<em>spans<br data-docshelf-line-break-after="5">\nlines<\/em>/);
  assert.match(html, /<br data-docshelf-line-break-after="6">\ngamma<\/p>/);
});

test('hosted Markdown assets use the configured DocShelf base path', async () => {
  const html = await renderMarkdownArtifact(
    {
      title: 'Hosted notes',
      description: 'A hosted document.',
      sourcePath: '/workspace/hosted.md',
    },
    `# Hosted notes

\`\`\`mermaid
flowchart LR
  README --> Pages
\`\`\`
`,
    { basePath: '/docshelf/' },
  );

  assert.match(html, /href="\/docshelf\/markdown-tokyo-night\.css"/);
  assert.match(html, /src="\/docshelf\/markdown-line-links\.js" defer/);
  assert.match(html, /src="\/docshelf\/mermaid\.min\.js" defer/);
  assert.match(html, /src="\/docshelf\/markdown-mermaid\.js" defer/);
});

test('site paths support a validated deployment base', () => {
  assert.equal(normalizeBasePath(undefined), '/');
  assert.equal(normalizeBasePath('docshelf'), '/docshelf/');
  assert.equal(normalizeBasePath('/projects/docshelf/'), '/projects/docshelf/');
  assert.equal(sitePath('/artifacts/example.html', '/docshelf'), '/docshelf/artifacts/example.html');
  assert.equal(
    artifactViewerUrl('example/report.html', '', '#L4-L8', '/docshelf/'),
    '/docshelf/?artifact=example%2Freport.html#L4-L8',
  );
  assert.throws(() => normalizeBasePath('/docshelf/../private'), /Invalid/);
  assert.throws(() => normalizeBasePath('/docshelf?preview=true'), /Invalid/);
});

test('line permalink helpers accept only canonical, ordered source ranges', () => {
  assert.deepEqual(parseLineFragment('#L14'), { start: 14, end: 14 });
  assert.deepEqual(parseLineFragment('#L14-L20'), { start: 14, end: 20 });
  assert.equal(parseLineFragment('#L20-L14'), null);
  assert.equal(parseLineFragment('#L0'), null);
  assert.equal(parseLineFragment('#context'), null);
  assert.equal(createLineFragment(14), '#L14');
  assert.equal(createLineFragment(14, 20), '#L14-L20');
  assert.throws(() => createLineFragment(0), /positive/);
});

test('Markdown rendering enables local Mermaid rendering for Mermaid fences', async () => {
  const html = await renderMarkdownArtifact(
    {
      title: 'System diagram',
      description: 'A Mermaid diagram.',
      sourcePath: '/workspace/diagram.md',
    },
    `# System

\`\`\`mermaid
flowchart LR
  Browser --> DocShelf
\`\`\`
`,
  );

  assert.match(html, /<code class="language-mermaid">/);
  assert.match(html, /<script src="\/mermaid\.min\.js" defer><\/script>/);
  assert.match(html, /<script src="\/markdown-mermaid\.js" defer><\/script>/);
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
    shelfRevision: 'unused-in-source-validation',
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

test('shelf loading rejects duplicate routes', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const firstSource = path.join(fixtureRoot, 'first.html');
  const secondSource = path.join(fixtureRoot, 'second.html');
  const shelfPath = path.join(fixtureRoot, 'shelf.json');
  await writeFile(firstSource, '<!doctype html><title>First</title>');
  await writeFile(secondSource, '<!doctype html><title>Second</title>');
  await writeShelf(shelfPath, [
    artifact(path.relative(docShelfRoot, firstSource)),
    artifact(path.relative(docShelfRoot, secondSource)),
  ]);

  await assert.rejects(loadShelfFrom(shelfPath), { message: /duplicates route/ });
});

test('shelf loading rejects sources outside the workspace root', async (t) => {
  const fixtureRoot = await createDocShelfFixture(t);
  const externalRoot = await temporaryDirectory(t, tmpdir(), 'docshelf-external-');
  const sourcePath = path.join(externalRoot, 'report.html');
  const shelfPath = path.join(fixtureRoot, 'shelf.json');
  await writeFile(sourcePath, '<!doctype html><title>Outside</title>');
  await writeShelf(shelfPath, [artifact(path.relative(docShelfRoot, sourcePath))]);

  await assert.rejects(loadShelfFrom(shelfPath), {
    message: /outside the workspace root \(the parent directory of DocShelf\)/,
  });
});

function createDocShelfFixture(t) {
  return temporaryDirectory(t, path.join(docShelfRoot, '.docshelf-runtime'), 'test-');
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

async function writeShelf(shelfPath, artifacts) {
  await writeFile(shelfPath, `${JSON.stringify({ version: 1, artifacts }, null, 2)}\n`);
}
