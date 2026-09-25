import assert from 'node:assert/strict';
import test from 'node:test';
import { distinctTitle, documentTitle, documentTree, excludedPath, parseDirectories } from '../src/directories.js';

test('Markdown title inference skips code and honors scalar front matter', () => {
  assert.equal(documentTitle('```sh\n# install dependencies\n```\n# Real title', 'fallback.md'), 'Real title');
  assert.equal(documentTitle('~~~sh\n# install dependencies\n~~~', 'fallback.md'), 'fallback');
  assert.equal(documentTitle('    # indented code\n# Heading', 'fallback.md'), 'Heading');
  assert.equal(documentTitle('---\ntitle: "Front matter"\n---\n# Heading', 'fallback.md'), 'Front matter');
  assert.equal(documentTitle('---\ntitle: Plain title # comment\n---\n# Heading', 'fallback.md'), 'Plain title');
  assert.equal(documentTitle('---\n# metadata comment\n---\n# Heading', 'fallback.md'), 'Heading');
});

test('titles that only restate their filename are omitted', () => {
  assert.equal(distinctTitle('Usage', 'usage.md'), '');
  assert.equal(distinctTitle('project review', 'project-review.html'), '');
  assert.equal(distinctTitle('Project Review', 'project_review.HTML'), '');
  assert.equal(distinctTitle('DocShelf', 'README.md'), 'DocShelf');
  assert.equal(distinctTitle('Q3 plan', 'notes.md'), 'Q3 plan');
  assert.equal(distinctTitle('Release notes', 'release.notes.md'), '');
  assert.equal(distinctTitle('C++', 'C.md'), 'C++');
  assert.equal(distinctTitle('Q&A', 'qa.md'), 'Q&A');
});

test('exact exclusions cover a named folder and everything inside it, literally', () => {
  assert.equal(excludedPath('drafts', ['./drafts']), true);
  assert.equal(excludedPath('drafts/deep/note.md', ['./drafts']), true);
  assert.equal(excludedPath('docs/drafts/note.md', ['./drafts']), false);
  assert.equal(excludedPath('drafts-old/note.md', ['./drafts']), false);
  assert.equal(excludedPath('notes [v2]?.md', ['./notes [v2]?.md']), true);
  assert.equal(excludedPath('guides/v2/intro.md', ['./guides/v2']), true);
});

test('name exclusions match at any depth, while path exclusions start at the selected root', () => {
  assert.equal(excludedPath('guides/drafts/note.md', ['drafts']), true);
  assert.equal(excludedPath('reviews/archive/old.md', ['reviews/archive']), true);
  assert.equal(excludedPath('team/reviews/archive/old.md', ['reviews/archive']), false);
  assert.equal(excludedPath('reviews/archive-2/old.md', ['reviews/archive']), false);
});

test('folder IDs must be unique lowercase names because generated routes use them', () => {
  const folder = id => ({ id, source: 'docs', project: 'Docs' });
  assert.deepEqual(parseDirectories([folder('docs'), folder('docs-2')]).map(entry => entry.id), ['docs', 'docs-2']);
  for (const value of [[folder('docs'), folder('docs')], [folder('Docs')]]) assert.throws(() => parseDirectories(value), /unique lowercase/);
});

test('common generated trees are skipped as descendants, never as selected roots', () => {
  for (const name of ['target', '_build', 'site', 'htmlcov']) assert.equal(excludedPath(`${name}/index.html`), true);
  assert.equal(excludedPath(''), false);
});

const segments = names => names.map((name, index) => ({ name, key: names.slice(0, index + 1).join(':') }));
const outline = nodes => nodes.map(node => node.type === 'folder' ? { [node.name]: outline(node.children) } : node.item);

test('document trees list folders first, keep document order, and merge single-folder chains', () => {
  const tree = documentTree([
    { item: 'z.md', folders: [] },
    { item: 'guide.md', folders: segments(['b', 'guides', 'v2']) },
    { item: 'a.md', folders: [] },
    { item: 'note.md', folders: segments(['a']) },
    { item: 'deep.md', folders: segments(['a', 'x', 'y']) },
  ]);
  assert.deepEqual(outline(tree), [{ a: [{ 'x/y': ['deep.md'] }, 'note.md'] }, { 'b/guides/v2': ['guide.md'] }, 'z.md', 'a.md']);
  assert.deepEqual([tree[1].key, tree[1].orderKey, tree[1].count], ['b:guides:v2', 'b', 1]);
  assert.deepEqual(documentTree([]), []);
});

test('registered folders retain empty rows and prevent compaction across their boundaries', () => {
  const root = [{ name: 'Reports', key: 'root', registered: true }];
  const nested = [...root, { name: 'Drafts', key: 'nested', registered: true }];
  const empty = documentTree([], [root, nested]);
  assert.deepEqual(outline(empty), [{ Reports: [{ Drafts: [] }] }]);
  assert.equal(empty[0].count, 0);
  const populated = documentTree([{ item: 'note.md', folders: nested }], [root, nested]);
  assert.equal(populated[0].key, empty[0].key);
  assert.equal(populated[0].children[0].key, empty[0].children[0].key);
  assert.equal(populated[0].count, 1);
  const renamed = documentTree([], [[{ ...root[0], name: 'Renamed' }]]);
  assert.equal(renamed[0].key, empty[0].key);
});
