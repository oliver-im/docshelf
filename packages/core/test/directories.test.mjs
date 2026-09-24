import assert from 'node:assert/strict';
import test from 'node:test';
import { distinctTitle, documentTitle, documentTree, excludedPath } from '../src/directories.js';

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

test('common generated trees are skipped as descendants, never as selected roots', () => {
  for (const name of ['target', '_build', 'site', 'htmlcov']) assert.equal(excludedPath(`${name}/index.html`), true);
  assert.equal(excludedPath(''), false);
});

test('document trees list folders first, keep document order, and merge single-folder chains', () => {
  const tree = documentTree([
    { item: 'z.md', folders: [] },
    { item: 'guide.md', folders: ['b', 'guides', 'v2'] },
    { item: 'a.md', folders: [] },
    { item: 'note.md', folders: ['a'] },
    { item: 'deep.md', folders: ['a', 'x', 'y'] },
  ]);
  assert.deepEqual(tree, [
    { type: 'folder', name: 'a', key: '["a"]', children: [
      { type: 'folder', name: 'x/y', key: '["a","x","y"]', children: [{ type: 'document', item: 'deep.md' }] },
      { type: 'document', item: 'note.md' },
    ] },
    { type: 'folder', name: 'b/guides/v2', key: '["b","guides","v2"]', children: [{ type: 'document', item: 'guide.md' }] },
    { type: 'document', item: 'z.md' },
    { type: 'document', item: 'a.md' },
  ]);
  assert.deepEqual(documentTree([]), []);
});
