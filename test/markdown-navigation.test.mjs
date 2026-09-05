import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const script = await readFile(new URL('../public/markdown-line-links.js', import.meta.url), 'utf8');

test('standalone heading navigation clears the selection and preserves the native fragment', () => {
  const page = runLineLinks({ hash: '#L2', standalone: true });
  assert.deepEqual(page.selected(), ['2']);
  page.navigate('#security');
  assert.equal(page.location.hash, '#security');
  assert.deepEqual(page.selected(), []);
  assert.equal(page.history.length, 0);
});

test('frame history mirrors heading, line, range, and empty fragments without pushing entries', () => {
  const page = runLineLinks({ hash: '#L2' });
  for (const [hash, selected] of [
    ['#security', []], ['#L2', ['2']], ['#L1-L3', ['1', '2', '3']],
    ['#L3', ['3']], ['#%ED%95%9C%EA%B5%AD%EC%96%B4', []], ['', []],
  ]) {
    page.navigate(hash);
    assert.deepEqual(page.selected(), selected);
    assert.equal(page.messages.at(-1).hash, hash);
    assert.equal(page.messages.at(-1).historyMode, 'replace');
  }
  assert.ok(page.history.every((entry) => entry.mode === 'replace'));
});

test('parent navigation updates the frame URL and section without reloading or echoing history', () => {
  const page = runLineLinks({ hash: '#L2' });
  page.apply('#security');
  assert.equal(page.location.hash, '#security');
  assert.deepEqual(page.selected(), []);
  assert.equal(page.heading.scrolls, 1);
  assert.equal(page.events.at(-1), 'docshelf:fragmentchange');
  page.apply('#L1-L3');
  assert.equal(page.location.hash, '#L1-L3');
  assert.deepEqual(page.selected(), ['1', '2', '3']);
  page.apply('');
  assert.equal(page.location.hash, '');
  assert.deepEqual(page.selected(), []);
  assert.equal(page.topScrolls, 1);
  assert.equal(page.messages.length, 0);
  assert.ok(page.history.every((entry) => entry.mode === 'replace'));
  assert.equal(page.location.searchParams.get('__docshelf_revision'), 'test');
});

test('fragment commands from unrelated windows or origins are ignored', () => {
  const page = runLineLinks({ hash: '#L2' });
  page.apply('#security', { source: {} });
  page.apply('#security', { origin: 'https://unrelated.example' });
  page.apply('https://unrelated.example');
  assert.equal(page.location.hash, '#L2');
  assert.deepEqual(page.selected(), ['2']);
});

// A small DOM surface runs the actual browser script. Geometry is fixed here;
// real scrolling and joint session history are checked in the browser.
function runLineLinks({ hash, standalone = false }) {
  const listeners = new Map();
  const messages = [], history = [], events = [];
  const location = new URL(`http://shelf.localhost/artifacts/test.html?__docshelf_revision=test${hash}`);
  const makeElement = () => ({
    dataset: {}, children: [], attributes: new Map(), scrolls: 0,
    style: { setProperty() {} },
    classList: { add() {} },
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener() {},
    getBoundingClientRect() { return { top: 0, bottom: 16, left: 0, right: 600, width: 600, height: 16 }; },
    querySelectorAll() { return []; },
    scrollIntoView() { this.scrolls += 1; },
  });
  const root = makeElement(), heading = makeElement();
  root.dataset.docshelfSourceLineCount = '3';
  root.parentElement = makeElement();
  let topScrolls = 0;
  const window = {
    location,
    matchMedia: () => ({ matches: true }),
    getComputedStyle: () => ({
      paddingBlockStart: '48', paddingBlockEnd: '80', paddingInlineStart: '48',
      insetInlineStart: '48', direction: 'ltr',
    }),
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent(event) { events.push(event.type); },
    scrollTo() { topScrolls += 1; },
    history: Object.fromEntries(['push', 'replace'].map((mode) => [
      `${mode}State`, (_state, _title, url) => {
        location.href = new URL(url, location).href;
        history.push({ mode, url });
      },
    ])),
  };
  window.parent = standalone ? window : {
    postMessage(message, origin) {
      assert.equal(origin, location.origin);
      messages.push(message);
    },
  };
  vm.runInNewContext(script, {
    URL, Event, window,
    document: {
      querySelector: () => root,
      createElement: makeElement,
      addEventListener() {},
      getElementById: (id) => id === 'security' ? heading : null,
    },
    ResizeObserver: class { observe() {} },
  });
  history.length = 0;
  return {
    location, messages, history, heading, events,
    get topScrolls() { return topScrolls; },
    selected() {
      return root.children.flatMap((node) => node.children)
        .filter((node) => node.attributes.get('aria-pressed') === 'true')
        .map((node) => node.dataset.docshelfSourceLine);
    },
    navigate(hash) {
      location.hash = hash;
      listeners.get('hashchange')();
    },
    apply(hash, overrides = {}) {
      listeners.get('message')({
        source: window.parent, origin: location.origin,
        data: { type: 'docshelf-apply-line-selection', hash }, ...overrides,
      });
    },
  };
}
