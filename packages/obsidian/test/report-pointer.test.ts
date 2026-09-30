import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/ui/report-pointer.ts', import.meta.url), 'utf8');
const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  const timers = new Map<number, () => void>();
  const listeners = new Map<string, (event: { button?: number; buttons?: number; clientX?: number; clientY?: number }) => void>();
  const classes = new Set<string>();
  const guestEvents: { type: string }[] = [];
  const hostEvents: { type: string }[] = [];
  let timer = 0;
  const win = {
    clearTimeout: (id: number) => timers.delete(id),
    setTimeout: (callback: () => void) => { timers.set(++timer, callback); return timer; },
    addEventListener: (type: string, callback: (event: object) => void) => listeners.set(type, callback),
    removeEventListener: (type: string) => listeners.delete(type),
    electronWindow: { webContents: { sendInputEvent: (event: { type: string }) => hostEvents.push(event) } },
  };
  const webview = {
    ownerDocument: { defaultView: win, body: { addClass: (name: string) => classes.add(name), removeClass: (name: string) => classes.delete(name) } },
    getBoundingClientRect: () => ({ left: 100, top: 50, right: 600, bottom: 550 }),
  };
  const guest = { getZoomFactor: () => 1, sendInputEvent: (event: { type: string }) => guestEvents.push(event) };
  const exports = {} as { ReportPointer: new (view: object, guest: () => object) => { down(): void; up(x: number, y: number): void } };
  runInNewContext(script, { exports, require: (name: string) => {
    assert.equal(name, 'electron');
    return { webFrame: { getZoomFactor: () => 1 } };
  } });
  const pointer = new exports.ReportPointer(webview, () => guest);
  const emit = (type: string, event: object) => listeners.get(type)?.(event);
  const settle = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } };
  const checkStopped = () => {
    assert.equal(classes.size, 0, 'The host must accept pointer input again.');
    assert.equal(listeners.size, 0);
    assert.equal(timers.size, 0);
  };
  return { pointer, emit, settle, guestEvents, hostEvents, checkStopped };
}

test('an outside release reaches the guest even if the pointer immediately moves', () => {
  const f = fixture();
  f.pointer.down();
  f.emit('mouseup', { button: 0, clientX: 40, clientY: 80 });
  f.emit('mousemove', { buttons: 0, clientX: 41, clientY: 80 });
  f.settle();
  assert.equal(f.guestEvents.filter(event => event.type === 'mouseUp').length, 1);
  assert.equal(f.hostEvents.length, 0);
  f.checkStopped();
});

test('a delayed inside release after a real move needs no duplicate release or pointer correction', () => {
  const f = fixture();
  f.pointer.down();
  f.emit('mouseup', { button: 0, clientX: 40, clientY: 80 });
  f.emit('mousemove', { buttons: 0, clientX: 141, clientY: 130 });
  f.pointer.up(40, 80);
  f.settle();
  assert.equal(f.guestEvents.length, 0);
  assert.equal(f.hostEvents.length, 0);
  f.checkStopped();
});
