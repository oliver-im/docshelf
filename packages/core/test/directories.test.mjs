import assert from 'node:assert/strict';
import test from 'node:test';
import { documentTitle, excludedPath } from '../src/directories.js';

test('Markdown title inference skips code and honors scalar front matter', () => {
  assert.equal(documentTitle('```sh\n# install dependencies\n```\n# Real title', 'fallback.md'), 'Real title');
  assert.equal(documentTitle('~~~sh\n# install dependencies\n~~~', 'fallback.md'), 'fallback');
  assert.equal(documentTitle('    # indented code\n# Heading', 'fallback.md'), 'Heading');
  assert.equal(documentTitle('---\ntitle: "Front matter"\n---\n# Heading', 'fallback.md'), 'Front matter');
  assert.equal(documentTitle('---\ntitle: Plain title # comment\n---\n# Heading', 'fallback.md'), 'Plain title');
  assert.equal(documentTitle('---\n# metadata comment\n---\n# Heading', 'fallback.md'), 'Heading');
});

test('common generated trees are skipped as descendants, never as selected roots', () => {
  for (const name of ['target', '_build', 'site', 'htmlcov']) assert.equal(excludedPath(`${name}/index.html`), true);
  assert.equal(excludedPath(''), false);
});
