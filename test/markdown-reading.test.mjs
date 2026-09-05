import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const script = await readFile(new URL('../public/markdown-reading.js', import.meta.url), 'utf8');

test('outline highlights clamped destinations and resumes tracking when the reader scrolls', () => {
  const listeners = new Map();
  const on = (type, listener) => listeners.set(type, listener);
  const entries = ['first', 'second', 'last'].map((id, index) => ({
    heading: { top: index * 300, getBoundingClientRect() { return { top: this.top }; }, focus() {} },
    link: {
      hash: `#${id}`, attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, value); },
      removeAttribute(name) { this.attributes.delete(name); },
    },
  }));
  const outline = {
    open: false,
    querySelectorAll: () => entries.map((entry) => entry.link),
    addEventListener: on,
  };
  const window = {
    location: { hash: '' }, innerHeight: 800, scrollY: 1200,
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    addEventListener: on,
    requestAnimationFrame(callback) { callback(); },
  };
  const root = { dataset: {}, querySelectorAll: () => [] };
  const document = {
    documentElement: { scrollHeight: 2000 },
    querySelector: (selector) => selector === '.markdown-document' ? root : outline,
    getElementById: (id) => entries.find((entry) => entry.link.hash === `#${id}`)?.heading,
  };
  vm.runInNewContext(script, { window, document });
  const current = () => entries.find((entry) => entry.link.attributes.has('aria-current'))?.link.hash;
  assert.equal(outline.open, true);
  assert.equal(current(), '#last', 'the final heading need not reach the top at maximum scroll');

  listeners.get('click')({ target: { closest: () => entries[1].link }, button: 0 });
  listeners.get('scroll')();
  assert.equal(current(), '#second', 'a clicked short section stays selected during clamped scrolling');

  window.scrollY = 600;
  listeners.get('keydown')({ key: 'PageUp' });
  assert.equal(current(), '#first', 'manual scrolling resumes position-based tracking');

  window.location.hash = '#last';
  listeners.get('docshelf:fragmentchange')();
  assert.equal(current(), '#last', 'parent-driven fragment changes update the outline too');
});
