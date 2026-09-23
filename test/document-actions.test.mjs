import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/document-actions.ts', import.meta.url), 'utf8');
const { outputText: script } = ts.transpileModule(source.replace(/^import .*;$/gm, '').replace(/^export /gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});

test('local action responses must be JSON records before capabilities or preview fields are read', async () => {
  const context = vm.createContext({});
  const readRecord = vm.runInContext(`${script}\nresponseRecord`, context);
  for (const value of [null, [], 'unexpected', 42, true]) {
    await assert.rejects(readRecord({ json: async () => value }), /invalid response/);
  }
  const result = { token: 'test-token', revealInFinder: true };
  assert.equal(await readRecord({ json: async () => result }), result);
});

test('browsers without Popover support can scroll, resize, and blur without selector errors', () => {
  const listeners = new Map();
  const on = (type, callback) => {
    const callbacks = listeners.get(type) || [];
    callbacks.push(callback);
    listeners.set(type, callbacks);
  };
  const element = () => ({
    setAttribute() {}, append() {}, addEventListener: on,
    matches() { throw new SyntaxError('Unsupported :popover-open selector'); },
  });
  const document = { createElement: element, body: element(), addEventListener: on };
  const context = vm.createContext({ document, window: { addEventListener: on }, location: { hostname: 'shelf.localhost' } });
  vm.runInContext(`${script}\nglobalThis.actions = createDocumentActions({ basePath: '/', localActions: true });`, context);
  const children = [];
  context.actions.add({ parentElement: { append: (child) => children.push(child) } }, () => undefined, () => '');
  assert.equal(children.length, 0, 'unsupported browsers retain ordinary document links');
  for (const event of ['scroll', 'resize', 'blur']) {
    assert.ok(listeners.has(event));
    for (const callback of listeners.get(event)) assert.doesNotThrow(callback);
  }
});
