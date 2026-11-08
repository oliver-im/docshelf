// Run: node scripts/test-web-folder-pins.mjs (installed Chrome, or CHROME_PATH / BROWSER_CHANNEL).
import { chromium } from 'playwright-core';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const src = await readFile(new URL('../src/components/ArtifactViewer.astro', import.meta.url), 'utf8');
const core = (await readFile(new URL('../packages/core/src/pins.js', import.meta.url), 'utf8')).replaceAll('export ', '');
const body = src.slice(src.indexOf('    function pinIdentity('), src.indexOf('    function registerSidebarLink('));
const menu = src.slice(src.indexOf('    function installShelfMenu('), src.indexOf('    function addImportedSidebarLink('));
// Use an installed Chrome by default, or CHROME_PATH / BROWSER_CHANNEL in CI.
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: process.env.BROWSER_CHANNEL || 'chrome' }), headless: true });
const unreadCode = src.slice(src.indexOf('    function showUnread()'), src.indexOf('    async function displayArtifact('));
const markerCode = src.slice(src.indexOf('  function setUnreadMarker('), src.indexOf('  function readStoredValue('));
const storageCode = src.slice(src.indexOf('    function readStoredPins()'), src.indexOf('    let pins = readStoredPins();'));
const listener = src.slice(src.indexOf("    window.addEventListener('storage', (event) => {"), src.indexOf('      if (event.key !== readStateStorageKey')) + '});';
try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('http://localhost:9988/**', r => r.fulfill({ body: '<div id="root"></div><div id="starlight__sidebar"><ul class="top-level"><li><details><summary><span class="large">Project</span></summary><ul><li><details><summary id="folder"><span class="large">a/b</span></summary><ul><li><a id="doc" href="#">Current document</a></li></ul></details></li></ul></details></li></ul></div>', contentType: 'text/html' }));
    await page.goto('http://localhost:9988');
    const setup = `
const root = document.querySelector('#root');
root.dataset.folderGroups = JSON.stringify([{ project: 'Project', folders: [{ key: 'b', keys: ['a', 'b'], name: 'a/b', title: 'a/b' }] }]);
const folderHeadings = new Map();
const sidebarLinks = [{ link: document.querySelector('#doc'), route: 'doc' }];
const artifacts = [{ sourceId: 'doc-source', route: 'doc' }];
const parseClaudeArtifactUrl = () => null;
const parseGitHubMarkdownUrl = () => null;
let currentArtifact;
const pinsKey = 'pins';
const folderPinsKey = 'pins:folders';
localStorage.setItem(pinsKey, JSON.stringify({ version: 1, sources: ['keep'] }));
localStorage.setItem(folderPinsKey, JSON.stringify({ version: 1, sources: [], folders: ['["Project","a"]'] }));
const readStoredValue = key => JSON.parse(localStorage.getItem(key));
const writeStoredValue = (key, next) => (localStorage.setItem(key, JSON.stringify(next)), true);
let pins = readStoredPins();
const markArtifactsRead = () => { };
const unread = new Set(['doc-source']);
const documentActions = { removalToken: async () => null };
`;
    await page.addScriptTag({ content: ts.transpileModule(core + storageCode + setup + body + menu + unreadCode + markerCode + listener + '\ninstallShelfMenu();showPins();', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText });
    assert.equal(await page.locator('[data-docshelf-folder-shortcut]').count(), 1);
    assert.equal(await page.locator('[data-docshelf-folder-shortcut] .docshelf-unread-dot').count(), 1);
    assert.match(await page.locator('[data-docshelf-folder-shortcut]').getAttribute('aria-description'), /Contains unread documents/);
    assert.equal(await page.locator('[data-docshelf-pins] > details > summary .docshelf-unread-dot').count(), 1);
    // A legacy tab writes document-only state; folder pins must remain in storage and on screen.
    const legacy = await page.context().newPage();
    await legacy.route('http://localhost:9988/**', r => r.fulfill({ body: 'legacy', contentType: 'text/html' }));
    await legacy.goto('http://localhost:9988');
    await legacy.evaluate(() => localStorage.setItem('pins', JSON.stringify({ version: 1, sources: ['legacy-document'] })));
    await page.waitForFunction(() => pins.sources.includes('legacy-document'));
    assert.equal(await page.locator('[data-docshelf-folder-shortcut]').count(), 1);
    await legacy.evaluate(() => localStorage.setItem('pins:folders', JSON.stringify({ version: 1, sources: [], folders: [] })));
    await page.waitForFunction(() => document.querySelectorAll('[data-docshelf-folder-shortcut]').length === 0);
    await legacy.evaluate(() => localStorage.setItem('pins:folders', JSON.stringify({ version: 1, sources: [], folders: ['["Project","a"]'] })));
    await page.waitForFunction(() => document.querySelectorAll('[data-docshelf-folder-shortcut]').length === 1);
    await legacy.close();
    await page.evaluate(() => { unread.clear(); showUnread(); });
    assert.equal(await page.locator('[data-docshelf-folder-shortcut] .docshelf-unread-dot').count(), 0);
    assert.equal(await page.locator('[data-docshelf-folder-shortcut]').getAttribute('aria-description'), 'Pinned folder.');
    assert.equal(await page.locator('[data-docshelf-pins] > details > summary .docshelf-unread-dot').count(), 0);
    await page.locator('[data-docshelf-folder-shortcut]').click();
    assert.equal(await page.locator('#folder').evaluate(el => document.activeElement === el && el.closest('details').open && el.closest('ul.top-level > li > details').open), true);
    await page.locator('#folder').press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Unpin folder', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-docshelf-folder-shortcut]').length === 0);
    await page.locator('#folder').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Pin folder', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-docshelf-folder-shortcut]').length === 1);
    await page.locator('[data-docshelf-folder-shortcut]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Unpin folder', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-docshelf-folder-shortcut]').length === 0);
    console.log('PASS: legacy document writes preserve folder pins; unread marker updates; collapsed alias pin renders, shortcut expands/focuses current folder, keyboard unpin, original pin, shortcut unpin.');
}
finally {
    await browser.close();
}
