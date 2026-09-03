import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const themeSyncScript = await readFile(
  new URL('../.agents/skills/docshelf/assets/theme-sync.js', import.meta.url),
  'utf8',
);

test('theme synchronization follows a framed DocShelf theme', () => {
  const harness = runThemeSync({ parentTheme: 'light', systemDark: true });

  assert.deepEqual(harness.root.dataset, {
    colorScheme: 'light',
    theme: 'light',
  });
  assert.deepEqual(harness.themes, ['light']);

  harness.notifyParent();
  assert.deepEqual(harness.themes, ['light']);

  harness.parentRoot.dataset.theme = 'dark';
  harness.notifyParent();
  assert.deepEqual(harness.root.dataset, {
    colorScheme: 'dark',
    theme: 'dark',
  });
  assert.deepEqual(harness.themes, ['light', 'dark']);
});

test('standalone theme synchronization follows system preference changes', () => {
  const harness = runThemeSync({ systemDark: false });

  assert.equal(harness.root.dataset.theme, 'light');
  assert.deepEqual(harness.themes, ['light']);

  harness.setSystemDark(true);
  assert.equal(harness.root.dataset.theme, 'dark');
  assert.equal(harness.root.dataset.colorScheme, 'dark');
  assert.deepEqual(harness.themes, ['light', 'dark']);
});

test('theme synchronization repairs a missing data-theme attribute', () => {
  const harness = runThemeSync({
    parentTheme: 'light',
    rootDataset: { colorScheme: 'light' },
    systemDark: true,
  });

  assert.deepEqual(harness.root.dataset, {
    colorScheme: 'light',
    theme: 'light',
  });
  assert.deepEqual(harness.themes, ['light']);
});

function runThemeSync({ parentTheme, rootDataset = {}, systemDark }) {
  const root = { dataset: { ...rootDataset } };
  const parentRoot = { dataset: {} };
  if (parentTheme) parentRoot.dataset.theme = parentTheme;

  let mediaListener;
  let parentListener;
  const themes = [];
  const media = {
    matches: systemDark,
    addEventListener(type, listener) {
      assert.equal(type, 'change');
      mediaListener = listener;
    },
  };
  const window = {
    matchMedia(query) {
      assert.equal(query, '(prefers-color-scheme: dark)');
      return media;
    },
    dispatchEvent(event) {
      themes.push(event.detail.theme);
    },
  };
  window.parent = parentTheme ? { document: { documentElement: parentRoot } } : window;

  class CustomEvent {
    constructor(type, options) {
      assert.equal(type, 'docshelf:themechange');
      this.detail = options.detail;
    }
  }

  class MutationObserver {
    constructor(listener) {
      parentListener = listener;
    }

    observe(target, options) {
      assert.equal(target, parentRoot);
      assert.equal(options.attributes, true);
      assert.deepEqual(Array.from(options.attributeFilter), ['data-theme']);
    }
  }

  vm.runInNewContext(themeSyncScript, {
    CustomEvent,
    document: { documentElement: root },
    MutationObserver,
    window,
  });

  return {
    notifyParent() {
      parentListener();
    },
    parentRoot,
    root,
    setSystemDark(value) {
      media.matches = value;
      mediaListener();
    },
    themes,
  };
}
