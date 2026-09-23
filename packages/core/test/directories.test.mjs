import assert from 'node:assert/strict';
import test from 'node:test';
import { distinctTitle, documentTitle, excludedPath } from '../src/directories.js';

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
});

test('common generated trees are skipped as descendants, never as selected roots', () => {
  for (const name of ['target', '_build', 'site', 'htmlcov']) assert.equal(excludedPath(`${name}/index.html`), true);
  assert.equal(excludedPath(''), false);
});
