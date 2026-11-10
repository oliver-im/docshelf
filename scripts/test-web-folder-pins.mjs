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
    await page.route('http://localhost:9988/**', r => r.fulfill({ body: '<div id="root"></div><div id="starlight__sidebar"><ul class="top-level"><li><details><summary id="project"><span class="large">Project</span></summary><ul><li><details><summary id="folder"><span class="large">a/b</span></summary><ul><li><a id="doc" href="#">Current document</a></li></ul></details></li></ul></details></li><li><details><summary id="empty-project"><span class="large">Empty</span></summary><ul></ul></details></li></ul></div>', contentType: 'text/html' }));
    await page.goto('http://localhost:9988');
    const setup = `
const root = document.querySelector('#root');
root.dataset.folderGroups = JSON.stringify([{ project: 'Project', folders: [{ key: 'b', keys: ['a', 'b'], name: 'a/b', title: 'a/b' }] }, { project: 'Empty', folders: [] }]);
const folderHeadings = new Map();
const projectHeadings = new Map();
const sidebarLinks = [{ link: document.querySelector('#doc'), route: 'doc' }];
const artifacts = [{ sourceId: 'doc-source', route: 'doc' }];
const parseClaudeArtifactUrl = () => null;
const parseGitHubMarkdownUrl = () => null;
let currentArtifact;
const pinsKey = 'pins';
const folderPinsKey = 'pins:folders';
const projectPinsKey = 'pins:projects';
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
    assert.equal(await page.locator('[data-docshelf-group-shortcut][data-docshelf-pin-kind="folder"]').count(), 1);
    assert.equal(await page.locator('[data-docshelf-group-shortcut][data-docshelf-pin-kind="folder"] .docshelf-unread-dot').count(), 1);
    assert.match(await page.locator('[data-docshelf-group-shortcut][data-docshelf-pin-kind="folder"]').getAttribute('aria-description'), /Contains unread documents/);
    assert.equal(await page.locator('[data-docshelf-pins] > details > summary .docshelf-unread-dot').count(), 1);
    // A legacy tab writes document-only state; folder pins must remain in storage and on screen.
    const legacy = await page.context().newPage();
    await legacy.route('http://localhost:9988/**', r => r.fulfill({ body: 'legacy', contentType: 'text/html' }));
    await legacy.goto('http://localhost:9988');
    await legacy.evaluate(() => localStorage.setItem('pins', JSON.stringify({ version: 1, sources: ['legacy-document'] })));
    await page.waitForFunction(() => pins.sources.includes('legacy-document'));
    assert.equal(await page.locator('[data-docshelf-group-shortcut][data-docshelf-pin-kind="folder"]').count(), 1);
    await legacy.evaluate(() => localStorage.setItem('pins:folders', JSON.stringify({ version: 1, sources: [], folders: [] })));
    await page.waitForFunction(() => document.querySelectorAll('[data-docshelf-group-shortcut][data-docshelf-pin-kind="folder"]').length === 0);
    await legacy.evaluate(() => localStorage.setItem('pins:folders', JSON.stringify({ version: 1, sources: [], folders: ['["Project","a"]'] })));
    await page.waitForFunction(() => document.querySelectorAll('[data-docshelf-group-shortcut][data-docshelf-pin-kind="folder"]').length === 1);
    await legacy.close();
    await page.evaluate(() => { unread.clear(); showUnread(); });
    assert.equal(await page.locator('[data-docshelf-group-shortcut][data-docshelf-pin-kind="folder"] .docshelf-unread-dot').count(), 0);
    assert.equal(await page.locator('[data-docshelf-group-shortcut][data-docshelf-pin-kind="folder"]').getAttribute('aria-description'), 'Pinned folder.');
    assert.equal(await page.locator('[data-docshelf-pins] > details > summary .docshelf-unread-dot').count(), 0);
    await page.locator('[data-docshelf-group-shortcut][data-docshelf-pin-kind="folder"]').click();
    assert.equal(await page.locator('#folder').evaluate(el => document.activeElement === el && el.closest('details').open && el.closest('ul.top-level > li > details').open), true);
    await page.locator('#folder').press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Unpin folder', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-docshelf-group-shortcut][data-docshelf-pin-kind="folder"]').length === 0);
    await page.locator('#folder').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Pin folder', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-docshelf-group-shortcut][data-docshelf-pin-kind="folder"]').length === 1);
    await page.locator('[data-docshelf-group-shortcut][data-docshelf-pin-kind="folder"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Unpin folder', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-docshelf-group-shortcut][data-docshelf-pin-kind="folder"]').length === 0);
    await page.locator('#project').press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Pin project', exact: true }).click();
    const projectPin = page.locator('[data-docshelf-group-shortcut][data-docshelf-pin-kind="project"]');
    await projectPin.waitFor();
    await page.evaluate(() => { unread.add('doc-source'); showUnread(); });
    assert.equal(await projectPin.locator('.docshelf-unread-dot').count(), 1);
    await page.evaluate(() => { unread.clear(); showUnread(); });
    assert.equal(await projectPin.locator('.docshelf-unread-dot').count(), 0);
    assert.equal(await page.locator('#project').getAttribute('data-docshelf-pinned'), '');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pins:projects')).projects), ['Project']);
    await page.locator('#project').click();
    await projectPin.click();
    assert.equal(await page.locator('#project').evaluate(el => document.activeElement === el && el.closest('details').open), true);
    // Pin storage refreshes preserve shortcut focus and do not erase old-kind state.
    await page.locator('[data-docshelf-pins] > details > summary').press('Shift+F10');
    assert.equal(await page.getByRole('menuitem', { name: /^(?:Unpin|Pin) (?:project|folder|group)$/ }).count(), 0);
    await page.keyboard.press('Escape');
    await projectPin.focus();
    await page.evaluate(() => { showPins(); });
    assert.equal(await projectPin.evaluate(el => document.activeElement === el), true);
    await projectPin.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Unpin project', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-docshelf-pin-kind="project"]').length === 0);
    // Empty registered projects are recognized during initial heading discovery.
    await page.locator('#empty-project').press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Pin project', exact: true }).click();
    await projectPin.waitFor();
    assert.equal(await projectPin.locator('.docshelf-pin-title').textContent(), 'Empty');
    assert.equal(await projectPin.locator('.docshelf-unread-dot').count(), 0);
    const otherTab = await page.context().newPage();
    await otherTab.route('http://localhost:9988/**', r => r.fulfill({ body: 'other tab', contentType: 'text/html' }));
    await otherTab.goto('http://localhost:9988');
    await otherTab.evaluate(() => localStorage.setItem('pins', JSON.stringify({ version: 1, sources: ['older-document'] })));
    await page.waitForFunction(() => pins.sources.includes('older-document'));
    assert.equal(await projectPin.count(), 1);
    await otherTab.evaluate(() => localStorage.setItem('pins:projects', JSON.stringify({ version: 1, projects: ['Missing'] })));
    await page.waitForFunction(() => document.querySelectorAll('[data-docshelf-pin-kind="project"]').length === 0);
    await otherTab.close();
    console.log('PASS: project and folder pin controls, shortcut focus, empty projects, stale-project omission, cross-tab storage synchronization and legacy preservation.');

}
finally {
    await browser.close();
}
