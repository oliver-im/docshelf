import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, cp, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { testNativeEditing } from './test-native-editing.mjs';
import { testNativeLines } from './test-native-lines.mjs';
import { testNativeLayout } from './test-native-layout.mjs';
import { testNativeRegressions } from './test-native-regressions.mjs';
import { testNativeModes } from './test-native-modes.mjs';
import { testReportRegressions } from './test-report-regressions.mjs';
import { testDirectories } from './test-directories.mjs';

// Use a separate profile, vault, and sources. Never load tests into the user's vault.
// Whatever the profile, Obsidian replaces its command-line socket in the home directory, or in XDG_RUNTIME_DIR
// on Linux, and second instances forward URIs through it. A separate home keeps the user's running app reachable.
if (process.platform === 'win32' || (process.platform !== 'darwin' && process.env.XDG_RUNTIME_DIR)) {
  throw new Error('The runtime test cannot isolate Obsidian\'s command-line socket here without taking over the running app\'s socket.');
}
const executable = process.env.OBSIDIAN_EXECUTABLE || '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const root = await mkdtemp(path.join(tmpdir(), 'docshelf-obsidian-'));
const profile = path.join(root, 'profile');
const home = path.join(root, 'home');
const env = { ...process.env, HOME: home };
// The keychain follows HOME on macOS; a mock keeps the test app from asking to create one or using the user's.
const isolation = [`--user-data-dir=${profile}`, '--use-mock-keychain'];
const vault = path.join(root, 'DocShelf runtime vault');
const workspace = path.join(root, 'workspace');
const pluginPath = path.join(vault, '.obsidian', 'plugins', 'docshelf');
const packageMode = process.argv.includes('--package');
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
await mkdir(profile, { recursive: true });
await mkdir(home);
await mkdir(pluginPath, { recursive: true });
await mkdir('.local/runtime', { recursive: true });
await cp('examples', workspace, { recursive: true });
if (packageMode) {
  const archive = unzipSync(await readFile(`dist/release/docshelf-${manifest.version}.zip`));
  const files = ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'];
  assert.deepEqual(Object.keys(archive).sort(), ['INSTALL.txt', ...files.map(name => `docshelf/${name}`)].sort());
  for (const name of files) await writeFile(path.join(pluginPath, name), archive[`docshelf/${name}`]);
} else {
  for (const name of ['main.js', 'manifest.json', 'styles.css']) await copyFile(name, path.join(pluginPath, name));
}
const bundleDirectory = process.env.OBSIDIAN_BUNDLE_DIRECTORY || path.join(homedir(), 'Library/Application Support/obsidian');
const bundles = (await readdir(bundleDirectory)).filter(name => /^obsidian-[\d.]+\.asar$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
if (!bundles[0]) throw new Error('No installed Obsidian runtime bundle found. Set OBSIDIAN_BUNDLE_DIRECTORY.');
await copyFile(path.join(bundleDirectory, bundles[0]), path.join(profile, bundles[0]));
await writeFile(path.join(profile, 'obsidian.json'), JSON.stringify({ vaults: { 'd0c5he1f00000001': { path: vault, open: true, ts: Date.now() } }, updateDisabled: true }));
await writeFile(path.join(vault, '.obsidian', 'community-plugins.json'), JSON.stringify(['docshelf']));
await writeFile(path.join(vault, '.obsidian', 'core-plugins.json'), JSON.stringify(['file-explorer', 'search']));
await writeFile(path.join(vault, '.obsidian', 'app.json'), JSON.stringify({ theme: 'obsidian' }));
const shelf = JSON.parse(await readFile(path.join(workspace, 'shelf.json'), 'utf8'));
for (const artifact of shelf.artifacts) artifact.source = path.join(workspace, artifact.source);
shelf.artifacts[1].project = 'Reports';
delete shelf.artifacts[0].description;
const shelfPath = path.join(vault, 'shelf.local.json');
// Exercise native editing and shelf mutations through a symlink throughout the runtime suite.
const shelfTarget = path.join(vault, '.shelf-source.json');
await writeFile(shelfTarget, JSON.stringify(shelf));
await symlink(shelfTarget, shelfPath);
await writeFile(path.join(pluginPath, 'data.json'), JSON.stringify({ shelfPath: 'shelf.local.json', workspaceRoot: workspace, runHtmlScripts: true }));

const log = createWriteStream('.local/runtime/obsidian.log');
const child = spawn(executable, [...isolation, '--remote-debugging-port=0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log); child.stderr.pipe(log);
let browser;
let page;
const pageErrors = [];
const dispatchProcesses = [];

async function poll(fn, message, timeout = 20_000) {
  const limit = Date.now() + timeout;
  while (Date.now() < limit) {
    try {
      const result = await Promise.race([fn(), new Promise(resolve => setTimeout(() => resolve(false), 1000))]);
      if (result) return result;
    } catch { /* Wait until the app is ready. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(message);
}

try {
  console.log(`Starting isolated ${bundles[0]} profile.`);
  const port = await poll(async () => (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0], 'Obsidian did not expose the test debugging port.', 30_000);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await poll(() => browser.contexts()[0].pages().find(page => page.url().includes('index.html')), 'The test vault did not open.');
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') console.error('Renderer:', entry.text()); });
  await page.waitForFunction(() => window.app?.workspace?.layoutReady, { timeout: 30_000 });
  await page.setViewportSize({ width: 1180, height: 860 });
  const trust = page.getByRole('button', { name: 'Trust author and enable plugins', exact: true });
  if (await trust.count()) await trust.click();
  await page.evaluate(async () => {
    await app.plugins.setEnable(true);
    await app.plugins.enablePluginAndSave('docshelf');
  });
  await page.waitForFunction(() => app.plugins.getPlugin('docshelf')?.catalog?.artifacts.length === 2);
  console.log('Plugin loaded and indexed two external documents.');
  if (packageMode) {
    assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').manifest.version), manifest.version);
    console.log(`Fresh installation from docshelf-${manifest.version}.zip passed.`);
  }
  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    await plugin.openShelf();
    await plugin.openArtifact(plugin.catalog.artifacts[0]);
  });
  const firstProject = page.locator('.docshelf-project-toggle').filter({ hasText: 'Getting started' });
  const secondProject = page.locator('.docshelf-project-toggle').filter({ hasText: 'Reports' });
  await poll(async () => (await page.locator('.docshelf-item:visible').count()) === 2, 'The initial shelf rows did not render.');
  assert.equal(await page.locator('.docshelf-shelf h2').count(), 0);
  assert.equal(await page.locator('.docshelf-item:visible').count(), 2);
  assert.equal(await page.locator('.docshelf-item-description, .docshelf-kind').count(), 0);
  assert.equal(await page.locator('.docshelf-item-icon svg').count(), 2);
  assert.deepEqual(await page.locator('.docshelf-project-count').allTextContents(), ['1', '1']);
  await firstProject.click();
  assert.equal(await firstProject.getAttribute('aria-expanded'), 'false');
  assert.equal(await secondProject.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('.docshelf-item:visible').count(), 1);
  await page.locator('.docshelf-search').fill('authored');
  assert.equal(await page.locator('.docshelf-item:visible').count(), 1);
  assert.equal(await page.locator('.docshelf-item-title').textContent(), 'guide.md');
  assert.equal(await page.locator('.docshelf-item-subtitle').textContent(), 'Project field notes');
  assert.match(await page.locator('.docshelf-item-description').textContent(), /authored/);
  assert.equal(await page.locator('.docshelf-item-project').textContent(), 'Getting started');
  await page.screenshot({ path: '.local/runtime/shelf-search.png' });
  await page.locator('.docshelf-search').fill('');
  assert.equal(await firstProject.getAttribute('aria-expanded'), 'false');
  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    await plugin.refresh();
    await plugin.openShelf();
  });
  assert.equal(await firstProject.getAttribute('aria-expanded'), 'false');
  // Recreate the view from its serialized workspace state, as on restart.
  await page.evaluate(async () => {
    const leaf = app.workspace.getLeavesOfType('docshelf-shelf')[0];
    const state = JSON.parse(JSON.stringify(leaf.getViewState()));
    await leaf.setViewState({ type: 'empty' });
    await leaf.setViewState(state);
  });
  assert.equal(await firstProject.getAttribute('aria-expanded'), 'false');
  await page.locator('.docshelf-search').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await firstProject.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Space');
  assert.equal(await firstProject.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('.docshelf-item:visible').count(), 2);

  const projectNames = () => page.locator('.docshelf-project-name').allTextContents();
  await firstProject.click();
  await secondProject.dragTo(firstProject, { targetPosition: { x: 24, y: 2 } });
  assert.deepEqual(await projectNames(), ['Reports', 'Getting started']);
  assert.equal(await firstProject.getAttribute('aria-expanded'), 'false');
  await page.locator('.docshelf-search').fill('authored');
  assert.equal(await page.locator('.docshelf-item:visible').count(), 1);
  await page.locator('.docshelf-search').fill('');
  await page.evaluate(async () => {
    await app.plugins.getPlugin('docshelf').refresh();
    const leaf = app.workspace.getLeavesOfType('docshelf-shelf')[0];
    const state = JSON.parse(JSON.stringify(leaf.getViewState()));
    await leaf.setViewState({ type: 'empty' });
    await leaf.setViewState(state);
  });
  assert.deepEqual(await projectNames(), ['Reports', 'Getting started']);
  assert.equal(await firstProject.getAttribute('aria-expanded'), 'false');

  // New projects follow a saved order; removing a project must not leave a gap.
  const extraSource = path.join(workspace, 'extra.md');
  await writeFile(extraSource, '# Additional project\n');
  const extra = { project: 'Alpha', source: extraSource, route: 'examples/extra.html', title: 'Additional project with a long title that should fit in one compact sidebar row' };
  await writeFile(shelfPath, JSON.stringify({ ...shelf, artifacts: [...shelf.artifacts, extra] }));
  await poll(async () => (await projectNames()).length === 3, 'The new project did not appear.');
  assert.deepEqual(await projectNames(), ['Reports', 'Getting started', 'Alpha']);
  const extraRow = page.locator('.docshelf-item').filter({ hasText: extra.title });
  assert.equal(await extraRow.locator('.docshelf-item-title').textContent(), 'extra.md');
  assert.equal(await extraRow.locator('.docshelf-item-subtitle').evaluate(el => el.scrollWidth > el.clientWidth), true);
  assert.ok((await extraRow.boundingBox()).height <= 32, 'Browsing rows should stay compact even with a long title.');
  await extraRow.hover();
  await page.locator('.tooltip').filter({ hasText: extra.title }).waitFor();
  await page.screenshot({ path: '.local/runtime/shelf-title-tooltip.png' });
  await page.mouse.move(900, 800);
  await writeFile(shelfPath, JSON.stringify({ ...shelf, artifacts: [shelf.artifacts[0], extra] }));
  await poll(async () => !(await projectNames()).includes('Reports'), 'The removed project stayed in the sidebar.');
  assert.deepEqual(await projectNames(), ['Getting started', 'Alpha']);
  await writeFile(shelfPath, JSON.stringify(shelf));
  await poll(async () => (await projectNames()).join(',') === 'Reports,Getting started', 'The original project order did not recover.');

  // An in-flight watcher refresh must preserve a drag and its drop target.
  const sourceBounds = await poll(() => secondProject.boundingBox(), 'The drag source did not settle after refresh.');
  const targetBounds = await poll(() => firstProject.boundingBox(), 'The drop target did not settle after refresh.');
  await page.mouse.move(sourceBounds.x + 50, sourceBounds.y + sourceBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBounds.x + 50, targetBounds.y + targetBounds.height - 2, { steps: 12 });
  await page.mouse.move(targetBounds.x + 51, targetBounds.y + targetBounds.height - 2);
  await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
  assert.equal(await page.locator('.docshelf-project-toggle.is-dragging').count(), 1);
  await page.screenshot({ path: '.local/runtime/project-drag.png' });
  await page.mouse.up();
  assert.deepEqual(await projectNames(), ['Getting started', 'Reports']);
  assert.equal(await page.locator('.docshelf-drop-before, .docshelf-drop-after, .is-dragging').count(), 0);

  const cancelSource = await secondProject.boundingBox();
  const cancelTarget = await firstProject.boundingBox();
  await page.mouse.move(cancelSource.x + 50, cancelSource.y + cancelSource.height / 2);
  await page.mouse.down();
  await page.mouse.move(cancelTarget.x + 50, cancelTarget.y + 2, { steps: 12 });
  await page.mouse.move(cancelTarget.x + 51, cancelTarget.y + 2);
  assert.equal(await page.locator('.docshelf-project-toggle.is-dragging').count(), 1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await projectNames(), ['Getting started', 'Reports']);
  assert.equal(await page.locator('.docshelf-drop-before, .docshelf-drop-after, .is-dragging').count(), 0);

  await secondProject.focus();
  await page.keyboard.press('Shift+F10');
  await page.locator('.menu-item').filter({ hasText: 'Move up' }).click();
  assert.deepEqual(await projectNames(), ['Reports', 'Getting started']);
  assert.equal(await secondProject.evaluate(el => el === document.activeElement), true);
  await secondProject.click({ button: 'right' });
  await page.locator('.menu-item').filter({ hasText: 'Reset project order' }).click();
  assert.deepEqual(await projectNames(), ['Getting started', 'Reports']);
  assert.equal(await firstProject.getAttribute('aria-expanded'), 'false');
  assert.equal(await readFile(shelfPath, 'utf8'), JSON.stringify(shelf));
  await firstProject.click();
  const guideRow = page.locator('.docshelf-item').filter({ hasText: 'Project field notes' });
  await guideRow.focus();
  await page.keyboard.press('Enter');
  await page.locator('.docshelf-native .cm-content').waitFor();
  assert.equal(await page.locator('.docshelf-item-description').count(), 0);
  console.log('Compact rows, full-title tooltips, optional descriptions, search excerpts, and keyboard opening passed.');
  console.log('Project dragging, refresh during drag, saved order, new/removed projects, keyboard reordering, and alphabetical reset passed.');

  // Document order belongs to each project and uses routes, not display titles.
  const alphaGuide = { ...extra, project: 'Getting started', title: 'Alpha guide' };
  const zuluGuide = { ...alphaGuide, source: path.join(workspace, 'zulu.md'), route: 'examples/zulu.html', title: 'Zulu guide' };
  const newGuide = { ...alphaGuide, source: path.join(workspace, 'new.md'), route: 'examples/new.html', title: 'Aardvark guide' };
  await writeFile(zuluGuide.source, '# Zulu guide\n');
  await writeFile(newGuide.source, '# Aardvark guide\n');
  const documentShelf = { ...shelf, artifacts: [...shelf.artifacts, alphaGuide, zuluGuide] };
  await writeFile(shelfPath, JSON.stringify(documentShelf));
  const guideGroup = page.locator('.docshelf-project').filter({ has: firstProject });
  const documentRoutes = () => guideGroup.locator('.docshelf-item').evaluateAll(rows => rows.map(row => row.dataset.route));
  const alphaRow = page.locator('.docshelf-item[data-route="examples/extra.html"]');
  const zuluRow = page.locator('.docshelf-item[data-route="examples/zulu.html"]');
  const reportRow = page.locator('.docshelf-item[data-route="examples/report.html"]');
  const guideRoute = shelf.artifacts[0].route;
  await poll(async () => (await documentRoutes()).length === 3, 'The document fixtures did not appear.');
  assert.deepEqual(await documentRoutes(), [alphaGuide.route, guideRoute, zuluGuide.route]);
  await zuluRow.dragTo(alphaRow, { targetPosition: { x: 30, y: 2 } });
  const customDocuments = [zuluGuide.route, alphaGuide.route, guideRoute];
  assert.deepEqual(await documentRoutes(), customDocuments);
  assert.equal(await zuluRow.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('docshelf-markdown').length), 1, 'Dragging must not open a document.');
  await firstProject.click();
  await page.evaluate(async () => {
    await app.plugins.getPlugin('docshelf').refresh();
    const leaf = app.workspace.getLeavesOfType('docshelf-shelf')[0];
    const state = JSON.parse(JSON.stringify(leaf.getViewState()));
    await leaf.setViewState({ type: 'empty' });
    await leaf.setViewState(state);
  });
  assert.equal(await firstProject.getAttribute('aria-expanded'), 'false');
  await firstProject.click();
  assert.deepEqual(await documentRoutes(), customDocuments);
  await page.locator('.docshelf-search').fill('guide');
  assert.deepEqual(await page.locator('.docshelf-item').evaluateAll(rows => rows.map(row => row.dataset.route)), await page.evaluate(() => app.plugins.getPlugin('docshelf').search.search('guide').map(hit => hit.artifact.route)));
  assert.equal(await page.locator('.docshelf-item').evaluateAll(rows => rows.some(row => row.draggable)), false);
  await page.locator('.docshelf-search').fill('');
  assert.deepEqual(await documentRoutes(), customDocuments);

  documentShelf.artifacts.push(newGuide);
  await writeFile(shelfPath, JSON.stringify(documentShelf));
  await poll(async () => (await documentRoutes()).length === 4, 'The new document did not appear.');
  assert.deepEqual(await documentRoutes(), [...customDocuments, newGuide.route]);
  zuluGuide.title = 'A renamed Zulu guide';
  await writeFile(shelfPath, JSON.stringify(documentShelf));
  await poll(() => zuluRow.filter({ hasText: zuluGuide.title }).count(), 'The renamed title did not refresh.');
  assert.deepEqual(await documentRoutes(), [...customDocuments, newGuide.route]);
  await writeFile(shelfPath, JSON.stringify({ ...documentShelf, artifacts: documentShelf.artifacts.filter(artifact => artifact !== alphaGuide) }));
  await poll(async () => (await documentRoutes()).length === 3, 'The removed document stayed in the list.');
  assert.deepEqual(await documentRoutes(), [zuluGuide.route, guideRoute, newGuide.route]);
  await writeFile(shelfPath, JSON.stringify(documentShelf));
  await poll(async () => (await documentRoutes()).length === 4, 'The restored document did not appear.');
  assert.deepEqual(await documentRoutes(), [...customDocuments, newGuide.route]);

  const startDocumentDrag = async (source, target, after = false) => {
    const from = await source.boundingBox();
    const to = await target.boundingBox();
    const y = to.y + (after ? to.height - 2 : 2);
    await page.mouse.move(from.x + 30, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 30, y, { steps: 12 });
    await page.mouse.move(to.x + 31, y);
  };
  await startDocumentDrag(guideRow, zuluRow, true);
  await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
  assert.equal(await page.locator('.docshelf-item.is-dragging').count(), 1);
  assert.equal(await page.locator('.docshelf-item.docshelf-drop-after').count(), 1);
  await page.screenshot({ path: '.local/runtime/document-drag.png' });
  await page.mouse.up();
  const movedDocuments = [zuluGuide.route, guideRoute, alphaGuide.route, newGuide.route];
  assert.deepEqual(await documentRoutes(), movedDocuments);
  await startDocumentDrag(guideRow, alphaRow, true);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await documentRoutes(), movedDocuments);
  await guideRow.dragTo(reportRow, { targetPosition: { x: 30, y: 2 } });
  assert.deepEqual(await documentRoutes(), movedDocuments);
  assert.deepEqual(await projectNames(), ['Getting started', 'Reports']);
  assert.equal(await page.locator('.docshelf-drop-before, .docshelf-drop-after, .is-dragging').count(), 0);

  // A registration moved to another project while dragging is no longer a valid source.
  await startDocumentDrag(zuluRow, alphaRow);
  assert.equal(await page.locator('.docshelf-item.is-dragging').getAttribute('data-route'), zuluGuide.route);
  await writeFile(shelfPath, JSON.stringify({ ...documentShelf, artifacts: documentShelf.artifacts.map(artifact => artifact === zuluGuide ? { ...artifact, project: 'Reports' } : artifact) }));
  await poll(() => page.evaluate(() => app.plugins.getPlugin('docshelf').catalog.artifacts.find(artifact => artifact.route === 'examples/zulu.html')?.project === 'Reports'), 'Project membership did not refresh during the drag.');
  await page.mouse.up();
  assert.deepEqual(await documentRoutes(), [guideRoute, alphaGuide.route, newGuide.route]);
  await writeFile(shelfPath, JSON.stringify(documentShelf));
  await poll(async () => (await documentRoutes()).length === 4, 'The original project membership did not recover.');
  assert.deepEqual(await documentRoutes(), movedDocuments);
  await guideRow.focus();
  await page.keyboard.press('Shift+F10');
  await page.locator('.menu-item').filter({ hasText: 'Move up' }).click();
  assert.deepEqual(await documentRoutes(), [guideRoute, zuluGuide.route, alphaGuide.route, newGuide.route]);
  assert.equal(await guideRow.evaluate(el => el === document.activeElement), true);
  await guideRow.click({ button: 'right' });
  await page.locator('.menu-item').filter({ hasText: 'Move down' }).click();
  assert.deepEqual(await documentRoutes(), movedDocuments);
  await guideRow.click({ button: 'right' });
  assert.equal(await page.locator('.menu-item').filter({ hasText: 'Reset to alphabetical' }).count(), 0, 'Alphabetical reset belongs only in project heading menus.');
  assert.equal(await page.locator('.menu-item').filter({ hasText: 'Remove from shelf…' }).count(), 1);
  await page.keyboard.press('Escape');
  assert.deepEqual(await documentRoutes(), movedDocuments);
  await firstProject.click({ button: 'right' });
  assert.equal(await page.locator('.menu-item').filter({ hasText: 'Reset project order' }).evaluate(el => el.classList.contains('is-disabled')), true);
  await page.locator('.menu-item').filter({ hasText: 'Reset to alphabetical' }).click();
  // Rows are labeled by filename (extra, guide, new, zulu), so alphabetical order follows filenames, not titles.
  assert.deepEqual(await documentRoutes(), [alphaGuide.route, guideRoute, newGuide.route, zuluGuide.route]);
  assert.deepEqual(await projectNames(), ['Getting started', 'Reports']);
  assert.equal(await firstProject.evaluate(el => el === document.activeElement), true);
  assert.equal(await readFile(shelfPath, 'utf8'), JSON.stringify(documentShelf), 'Reordering must not edit shelf registrations.');
  await writeFile(shelfPath, JSON.stringify(shelf));
  await poll(async () => (await documentRoutes()).length === 1, 'The document fixtures did not clear.');
  console.log('Document dragging, saved order, renames, new/removed documents, search relevance, drag cancellation, project boundaries, and order menus passed.');

  // A shelf file that does not exist yet is the empty starting state, not an error.
  const shelfSettings = await page.evaluate(() => ({ ...app.plugins.getPlugin('docshelf').settings }));
  await page.evaluate(settings => app.plugins.getPlugin('docshelf').configure({ ...settings, shelfPath: 'new-shelf.json' }), shelfSettings);
  await page.locator('.docshelf-empty-shelf').waitFor();
  assert.deepEqual(await page.evaluate(() => [app.plugins.getPlugin('docshelf').shelfMissing, app.plugins.getPlugin('docshelf').error]), [true, '']);
  assert.equal(await page.locator('.docshelf-status').textContent(), '');
  assert.match(await page.locator('.docshelf-empty-note').textContent(), /new-shelf\.json$/);
  await page.evaluate(settings => app.plugins.getPlugin('docshelf').configure(settings), shelfSettings);
  await poll(async () => (await documentRoutes()).length === 1, 'The shelf did not reload after leaving the missing shelf.');
  assert.equal(await page.locator('.docshelf-empty-shelf').count(), 0);
  console.log('A missing shelf file shows the empty shelf without an error.');

  assert.equal(await page.evaluate(() => app.commands.executeCommandById('docshelf:reload')), true);
  await poll(() => page.evaluate(() => !app.plugins.getPlugin('docshelf').loading), 'Reload command did not complete.');
  assert.equal(await page.evaluate(() => app.commands.executeCommandById('docshelf:configure')), true);
  const configurationPage = await poll(async () => {
    for (const candidate of browser.contexts()[0].pages()) {
      if (await candidate.getByText('Configure DocShelf', { exact: true }).isVisible()) return candidate;
    }
  }, 'The configure command did not open the configuration dialog.');
  const readableBefore = await page.evaluate(() => app.vault.getConfig('readableLineLength'));
  const widthToggle = configurationPage.locator('.setting-item').filter({ hasText: 'Readable line length' }).locator('.checkbox-container');
  assert.equal(await widthToggle.evaluate(el => el.classList.contains('is-enabled')), readableBefore);
  await widthToggle.click();
  await page.waitForFunction(value => app.vault.getConfig('readableLineLength') === value, !readableBefore);
  await configurationPage.keyboard.press('Escape');
  await page.evaluate(() => app.commands.executeCommandById('docshelf:configure'));
  await widthToggle.waitFor();
  assert.equal(await widthToggle.evaluate(el => el.classList.contains('is-enabled')), !readableBefore, 'Display preferences must apply without Save and reload and survive reopening configuration.');
  await widthToggle.click();
  await page.waitForFunction(value => app.vault.getConfig('readableLineLength') === value, readableBefore);
  await configurationPage.keyboard.press('Escape');
  const searchableSettings = await page.evaluate(() => {
    const tab = app.setting.pluginTabs.find(tab => tab.id === 'docshelf');
    if (!tab) throw new Error('DocShelf settings tab is missing.');
    return tab.getSettingDefinitions().map(item => item.name);
  });
  assert.deepEqual(searchableSettings, ['Shelf file', 'Workspace root', 'Vault ID for links', 'Run HTML scripts', 'Apply shelf settings', 'Readable line length']);
  const originalVaultId = await page.evaluate(() => app.plugins.getPlugin('docshelf').settings.vaultId);
  await page.evaluate(() => { app.setting.open(); app.setting.openTabById('docshelf'); });
  const settingsPage = await poll(async () => {
    for (const candidate of browser.contexts()[0].pages()) {
      if (await candidate.getByText('Apply shelf settings', { exact: true }).isVisible()) return candidate;
    }
  }, 'The declarative settings tab did not render.');
  const vaultIdInput = settingsPage.locator('.setting-item').filter({ has: settingsPage.getByText('Vault ID for links', { exact: true }) }).locator('input');
  await vaultIdInput.fill('review-test-vault');
  assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').settings.vaultId), originalVaultId, 'Editing searchable settings must preserve the draft until Save and reload.');
  await page.evaluate(() => app.setting.pluginTabs.find(tab => tab.id === 'docshelf').update());
  assert.equal(await vaultIdInput.inputValue(), 'review-test-vault', 'Rebuilding settings definitions must retain unsaved edits.');
  assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').settings.vaultId), originalVaultId, 'A settings tab update must not persist the draft.');
  await settingsPage.getByRole('button', { name: 'Save and reload', exact: true }).click();
  await poll(() => page.evaluate(() => app.plugins.getPlugin('docshelf').settings.vaultId === 'review-test-vault' && !app.plugins.getPlugin('docshelf').loading), 'The declarative settings tab did not save.');
  await vaultIdInput.fill(originalVaultId);
  assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').settings.vaultId), 'review-test-vault', 'A saved draft must not alias the active plugin settings.');
  await settingsPage.getByRole('button', { name: 'Save and reload', exact: true }).click();
  await poll(() => page.evaluate(value => app.plugins.getPlugin('docshelf').settings.vaultId === value && !app.plugins.getPlugin('docshelf').loading, originalVaultId), 'The test settings did not restore.');
  await page.evaluate(() => app.setting.close());
  console.log('Searchable settings render, retain drafts until Save and reload, and persist through the normal configure path.');
  console.log('Collapsible projects, search across collapsed groups, workspace restoration, keyboard controls, and shelf commands passed.');
  await testNativeEditing({ page, poll, workspace, shelfPath, shelf, pluginPath });
  await testNativeModes({ page, poll });
  await testNativeLines({ page, poll, workspace });
  await testNativeLayout({ page, poll, workspace });
  const replacePluginFiles = packageMode ? async () => {
    const settings = await readFile(path.join(pluginPath, 'data.json'));
    const shelfBefore = await readFile(shelfPath);
    const recoveryPath = path.join(pluginPath, 'recovery');
    const names = (await readdir(recoveryPath)).sort();
    assert.ok(names.some(name => name.endsWith('.json')), 'Upgrade must exercise a real recovery draft.');
    const recovery = await Promise.all(names.map(name => readFile(path.join(recoveryPath, name))));
    // Simulate a stale installed asset, then follow Obsidian's three-file update.
    await writeFile(path.join(pluginPath, 'styles.css'), '/* previous installation */');
    for (const name of ['main.js', 'manifest.json', 'styles.css']) {
      await copyFile(path.join('dist/release', name), path.join(pluginPath, name));
      assert.deepEqual(await readFile(path.join(pluginPath, name)), await readFile(path.join('dist/release', name)));
    }
    assert.deepEqual(await readFile(path.join(pluginPath, 'data.json')), settings);
    assert.deepEqual(await readFile(shelfPath), shelfBefore);
    assert.deepEqual((await readdir(recoveryPath)).sort(), names);
    for (let i = 0; i < names.length; i++) assert.deepEqual(await readFile(path.join(recoveryPath, names[i])), recovery[i]);
    console.log('Plugin file replacement preserved settings, shelf, and recovery files byte-for-byte.');
  } : undefined;
  await testNativeRegressions({ page, poll, workspace, replacePluginFiles });
  await page.evaluate(() => {
    const view = app.plugins.getPlugin('docshelf').nativeViews()[0];
    view.editor.setSelection({ line: 6, ch: 0 }, { line: 8, ch: view.editor.getLine(8).length });
  });
  assert.equal(await page.evaluate(() => app.commands.executeCommandById('docshelf:copy-link')), true);
  const permalink = await page.evaluate(() => require('electron').clipboard.readText());
  const params = new URL(permalink).searchParams;
  assert.equal(params.get('source'), shelf.artifacts[0].source);
  assert.equal(params.get('lines'), '7-9');
  assert.equal(params.has('path'), false);
  await page.evaluate(() => app.commands.executeCommandById('docshelf:copy-reference'));
  assert.match(await page.evaluate(() => require('electron').clipboard.readText()), /guide\.md:7-9$/);
  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    await plugin.openArtifact(plugin.catalog.artifacts[0], { start: 1, end: 1 });
  });
  const dispatch = spawn(executable, [...isolation, permalink], { env, stdio: 'ignore' });
  dispatchProcesses.push(dispatch);
  await poll(() => page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews().some(view => view.editor.getCursor('from').line === 6 && view.editor.getCursor('to').line === 8)), 'The URI did not select the source lines in the native editor.');
  dispatch.kill('SIGKILL');
  console.log('Native selection, copied source references, and Obsidian URI routing passed.');

  const showNativePreview = () => page.evaluate(async () => {
    const view = app.plugins.getPlugin('docshelf').nativeViews().find(view => view.contentEl.offsetParent !== null);
    await view.leaf.setViewState({ type: 'docshelf-markdown', active: true, state: { ...view.getState(), mode: 'preview' } });
  });
  await showNativePreview();
  await page.locator('.docshelf-native .markdown-preview-view:visible h1').waitFor();
  await page.screenshot({ path: '.local/runtime/reading-dark.png' });
  await page.evaluate(() => { document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light'); });
  await page.screenshot({ path: '.local/runtime/reading-light.png' });
  await page.evaluate(() => { document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark'); });

  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    await plugin.openArtifact(plugin.catalog.artifacts[1]);
  });
  await page.locator('webview.docshelf-webview').waitFor();
  assert.equal(await page.locator('.view-header-title:visible').last().textContent(), 'Release report');
  const reportStatus = page.locator('.docshelf-document .docshelf-editor-status');
  await page.locator('.view-action[aria-label="Switch to source view"]:visible').click();
  await page.locator('.docshelf-source-row:visible [data-line="3"]').click();
  assert.equal(await reportStatus.locator('.docshelf-reference-label').textContent(), 'Source line 3');
  await page.screenshot({ path: '.local/runtime/report-source.png' });
  await reportStatus.getByRole('button', { name: 'Clear selection' }).click();
  assert.equal(await reportStatus.isHidden(), true);
  await page.locator('.view-action[aria-label="Switch to report view"]:visible').click();
  await page.locator('webview.docshelf-webview').waitFor();
  const guest = script => page.evaluate(script => document.querySelector('webview.docshelf-webview').executeJavaScript(script), script);
  await poll(() => guest('!!document.querySelector("#run-check")'), 'The interactive HTML report did not load.');
  // The reference menu must not depend on native menus, which macOS uses by default.
  const nativeMenus = await page.evaluate(() => { const value = app.vault.getConfig('nativeMenus'); app.vault.setConfig('nativeMenus', true); return value; });
  // Obsidian's own webview menu would open beside the reference menu.
  const defaultMenuOff = () => page.evaluate(() => require('@electron/remote').webContents.fromId(document.querySelector('webview.docshelf-webview').getWebContentsId()).noContextMenu);
  assert.equal(await defaultMenuOff(), true);
  // Report scripts may be disabled, so inspect the report from an isolated world.
  const inReportWorld = async code => JSON.parse(await page.evaluate(code => {
    const webview = document.querySelector('webview.docshelf-webview');
    return require('@electron/remote').webContents.fromId(webview.getWebContentsId()).executeJavaScriptInIsolatedWorld(1002, [{ code }]);
  }, `JSON.stringify((() => { ${code} })())`));
  const reportPoint = async (selector, offset = 8) => {
    const [x, y] = await inReportWorld(`const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [box.left + ${offset}, box.top + box.height / 2];`);
    const frame = await page.locator('webview.docshelf-webview').boundingBox();
    return [frame.x + x, frame.y + y];
  };
  const outlined = () => inReportWorld(`return ['h1', '.intro', 'section'].filter(selector => getComputedStyle(document.querySelector(selector)).outlineStyle === 'solid');`);
  const copied = async () => (await page.evaluate(() => require('electron').clipboard.readText())).split('/').at(-1);
  const reportLabel = () => reportStatus.locator('.docshelf-reference-label').textContent();
  // Collapsing the report's selection clears its reference.
  const resetReport = async () => {
    await inReportWorld('getSelection().removeAllRanges(); return null;');
    await poll(async () => await reportStatus.locator('.docshelf-reference-label').count() === 0 && (await outlined()).length === 0, 'The report reference did not clear.');
  };
  const selectReport = async (from, to, label) => {
    const [x1, y1] = await reportPoint(from);
    const [x2, y2] = await reportPoint(to);
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 6 });
    await page.mouse.up();
    await poll(async () => await reportStatus.locator('.docshelf-reference-label').count() === 1 && await reportLabel() === label, `The report selection did not show ${label}.`);
  };
  const reportMenuItem = page.locator('.menu .menu-item').filter({ hasText: 'Copy source reference' });
  const copyReportReference = async (selector, offset, screenshot) => {
    const [x, y] = await reportPoint(selector, offset);
    await page.mouse.click(x, y, { button: 'right' });
    await reportMenuItem.waitFor();
    const shown = { label: await reportLabel(), outlined: await outlined() };
    if (screenshot) await page.screenshot({ path: screenshot });
    await reportMenuItem.click();
    return { ...shown, copied: await copied() };
  };
  assert.deepEqual(await copyReportReference('h1', 8, '.local/runtime/report-reference.png'), { label: 'Source line 13', outlined: ['h1'], copied: 'report.html:13' });
  await resetReport();
  const [menuX, menuY] = await reportPoint('.intro');
  await page.mouse.click(menuX, menuY, { button: 'right' });
  await reportMenuItem.waitFor();
  await page.mouse.click(menuX, menuY);
  await poll(async () => await page.locator('.menu, .docshelf-report-layer').count() === 0, 'A click inside the report left its reference menu open.');
  await resetReport();
  // A left-drag selection drives the highlight, footer, header copy actions, and Source view.
  await selectReport('h1', '.intro', 'Source lines 13–14');
  assert.deepEqual(await outlined(), ['h1', '.intro']);
  await page.screenshot({ path: '.local/runtime/report-selection.png' });
  // Copy notices can cover the header actions, so dispatch their clicks.
  await page.locator('.view-action[aria-label="Copy source reference"]:visible').dispatchEvent('click');
  await poll(async () => await copied() === 'report.html:13-14', 'The header action did not copy the selected report lines.');
  // The menu replaces Obsidian's, so it also copies selected text.
  const [copyX, copyY] = await reportPoint('h1', 40);
  await page.mouse.click(copyX, copyY, { button: 'right' });
  await page.locator('.menu .menu-item').filter({ hasText: /^Copy$/ }).click();
  await poll(async () => /^Ready for a closer look\./.test(await page.evaluate(() => require('electron').clipboard.readText())), 'The report menu did not copy the selected text.');
  const copiedHtml = await page.evaluate(() => require('electron').clipboard.readHTML());
  assert.match(copiedHtml, /<h1[^>]*>Ready for a closer look\.<\/h1>/);
  assert.doesNotMatch(copiedHtml, /data-docshelf-lines/);
  assert.deepEqual(await copyReportReference('h1', 40), { label: 'Source lines 13–14', outlined: ['h1', '.intro'], copied: 'report.html:13-14' });
  await page.locator('.view-action[aria-label="Switch to source view"]:visible').dispatchEvent('click');
  assert.deepEqual(await page.locator('.docshelf-source-row.is-selected:visible [data-line]').evaluateAll(buttons => buttons.map(button => button.dataset.line)), ['13', '14']);
  await page.locator('.view-action[aria-label="Switch to report view"]:visible').dispatchEvent('click');
  await poll(() => guest('!!document.querySelector("#run-check")'), 'The report did not return from Source view.');
  await selectReport('h1', '.intro', 'Source lines 13–14');
  await reportStatus.getByRole('button', { name: 'Clear selection' }).click();
  await poll(async () => await reportStatus.isHidden() && (await outlined()).length === 0 && await inReportWorld('return getSelection().isCollapsed;'), 'Clear selection left the report reference in place.');
  // A drag that leaves the report must not reach the rest of the window, and
  // the report must see its release there, or it keeps selecting.
  await inReportWorld("window.releases = 0; document.addEventListener('mouseup', () => window.releases++, true); return null;");
  const shelfRow = await page.locator('.docshelf-item:visible').first().boundingBox();
  const [dragX, dragY] = await reportPoint('h1');
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(shelfRow.x + shelfRow.width / 2, shelfRow.y + shelfRow.height / 2, { steps: 8 });
  assert.equal(await page.locator('.docshelf-item:hover').count(), 0);
  await page.mouse.up();
  await poll(async () => await inReportWorld('return window.releases;') === 1, 'The report did not see a release outside it.');
  await page.mouse.move(shelfRow.x + shelfRow.width / 2, shelfRow.y + shelfRow.height / 2 + 1);
  await poll(async () => await page.locator('.docshelf-item:hover').count() === 1, 'The window ignored the pointer after a report drag.');
  await resetReport();
  // Electron reports right-clicks unscaled by Obsidian's zoom.
  await page.evaluate(() => require('electron').webFrame.setZoomFactor(1.25));
  assert.deepEqual(await copyReportReference('h1', 8), { label: 'Source line 13', outlined: ['h1'], copied: 'report.html:13' });
  await page.evaluate(() => require('electron').webFrame.setZoomFactor(1));
  await resetReport();
  await page.evaluate(value => app.vault.setConfig('nativeMenus', value), nativeMenus);
  assert.deepEqual(await guest('({node:typeof require, process:typeof process, image:document.querySelector("img").naturalWidth, background:getComputedStyle(document.documentElement).backgroundColor})'), { node: 'undefined', process: 'undefined', image: 36, background: 'rgb(16, 24, 32)' });
  await guest('document.querySelector("#run-check").click()');
  assert.equal(await guest('document.querySelector("#checks").textContent'), '1');
  const appResource = await page.evaluate(() => app.vault.adapter.getResourcePath('shelf.local.json'));
  const probes = await guest(`(async () => {
    const result = {};
    for (const [name,url] of Object.entries(${JSON.stringify({ file: `file://${path.join(vault, 'shelf.local.json')}`, app: appResource, unregistered: 'private.json' })})) {
      try { const r=await fetch(url); result[name]=r.ok?'READABLE':'blocked'; } catch { result[name]='blocked'; }
    }
    try { result.parent = typeof window.parent.require; } catch { result.parent = 'blocked'; }
    return result;
  })()`);
  assert.deepEqual(probes, { file: 'blocked', app: 'blocked', unregistered: 'blocked', parent: 'undefined' });
  await page.screenshot({ path: '.local/runtime/report.png' });
  console.log('HTML scripts, relative CSS/image, and local-file isolation checks passed.');
  await testReportRegressions({ page, poll, workspace, shelfPath, shelf, guest });

  await guest('document.querySelector("a").click()');
  await poll(() => page.evaluate(() => app.plugins.getPlugin('docshelf').nativeViews().some(view => view.contentEl.offsetParent !== null && view.editor.getCursor('from').line === 6 && view.editor.getCursor('to').line === 8)), 'The HTML-to-Markdown range link did not navigate.');
  await showNativePreview();

  const guidePath = path.join(workspace, 'guide.md');
  const original = await readFile(guidePath, 'utf8');
  const watchedGuide = `${original}\n## Watcher verification\nA new wombat phrase.\n`;
  await writeFile(guidePath, watchedGuide);
  await poll(() => page.locator('.docshelf-native .markdown-preview-view:visible h2').filter({ hasText: 'Watcher verification' }).count(), 'External edits did not refresh the reader.');
  await page.locator('.docshelf-search').fill('wombat');
  await poll(async () => await page.locator('.docshelf-item').count() === 1, 'External edits did not refresh search.');
  console.log('Registered cross-document links and external-edit refresh passed.');

  await writeFile(guidePath, `${watchedGuide}\n[Jump to report section](report.html#checks)\n`);
  await poll(() => page.getByRole('link', { name: 'Jump to report section' }).count(), 'The report section link did not appear.');
  await page.getByRole('link', { name: 'Jump to report section' }).click();
  await poll(() => guest('location.hash === "#checks" && document.querySelector(":target")?.id === "checks"'), 'The HTML section fragment was lost.');
  console.log('Markdown-to-HTML section navigation passed.');

  await writeFile(shelfPath, JSON.stringify({ ...shelf, artifacts: [shelf.artifacts[0]] }));
  await poll(() => page.locator('.docshelf-document').filter({ hasText: 'This document is no longer registered.' }).count(), 'The removed registration stayed open.');
  await writeFile(shelfPath, JSON.stringify(shelf));
  await poll(() => guest('location.hash === "#checks" && !!document.querySelector("#run-check")'), 'The restored registration did not recover its open tab.');
  console.log('Removing and restoring a registration updates the open tab.');

  const reportPath = path.join(workspace, 'report.html');
  const report = await readFile(reportPath, 'utf8');
  await rm(reportPath);
  await poll(() => page.evaluate(() => {
    const plugin = app.plugins.getPlugin('docshelf');
    return plugin.catalog.artifacts.length === 2 && plugin.error.includes('ENOENT');
  }), 'Missing source was not reported while retaining its registration.');
  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    await plugin.openArtifact(plugin.catalog.artifacts[0]);
  });
  await showNativePreview();
  await writeFile(guidePath, `${watchedGuide}\n## Missing source verification\nA puffinreviewmarker phrase.\n`);
  await poll(() => page.locator('.docshelf-native .markdown-preview-view:visible h2').filter({ hasText: 'Missing source verification' }).count(), 'A missing source stopped another document from refreshing.');
  await page.locator('.docshelf-search').fill('puffinreviewmarker');
  await poll(async () => await page.locator('.docshelf-item').count() === 1, 'A missing source stopped another document from being indexed.');
  await writeFile(reportPath, report);
  await poll(() => page.evaluate(() => !app.plugins.getPlugin('docshelf').error), 'The source did not recover after being restored.');
  console.log('Healthy documents refresh and remain searchable while another source is missing.');

  const assetPath = path.join(workspace, 'assets', 'mark.svg');
  const asset = await readFile(assetPath);
  await rm(assetPath);
  await poll(() => page.evaluate(() => app.plugins.getPlugin('docshelf').error.includes('ENOENT')), 'The missing asset was not reported.');
  await writeFile(guidePath, `${watchedGuide}\n## Missing asset verification\nAn assetreviewmarker phrase.\n`);
  await poll(() => page.locator('.docshelf-native .markdown-preview-view:visible h2').filter({ hasText: 'Missing asset verification' }).count(), 'A missing asset stopped its document from refreshing.');
  await page.locator('.docshelf-search').fill('assetreviewmarker');
  await poll(async () => await page.locator('.docshelf-item').count() === 1, 'A missing asset prevented its document from being indexed.');
  await writeFile(assetPath, asset);
  await writeFile(guidePath, watchedGuide);
  await page.locator('.docshelf-search').fill('');
  await poll(() => page.evaluate(() => !app.plugins.getPlugin('docshelf').error), 'The asset did not recover after being restored.');
  console.log('Missing assets do not block document refresh or search.');

  await page.evaluate(async () => {
    const plugin = app.plugins.getPlugin('docshelf');
    await plugin.configure({ ...plugin.settings, runHtmlScripts: false });
    await plugin.openArtifact(plugin.catalog.artifacts[1]);
  });
  await poll(() => page.evaluate(() => {
    const view = document.querySelector('webview.docshelf-webview');
    return view && !view.isLoading() && view.getURL().startsWith('http://127.0.0.1:');
  }), 'Script-free report did not load.');
  await assert.rejects(guest('document.querySelector("#run-check").click()'));
  await page.evaluate(() => app.vault.setConfig('nativeMenus', true));
  assert.equal(await defaultMenuOff(), true);
  assert.deepEqual(await copyReportReference('h1', 8), { label: 'Source line 13', outlined: ['h1'], copied: 'report.html:13' });
  await resetReport();
  await selectReport('h1', '.intro', 'Source lines 13–14');
  assert.match(await reportStatus.textContent(), /^Report scripts are disabled/);
  await resetReport();
  await page.evaluate(value => app.vault.setConfig('nativeMenus', value), nativeMenus);
  console.log('Script-free HTML mode passed.');

  await testDirectories({ page, poll, workspace, shelfPath });
  const origin = await page.evaluate(() => app.plugins.getPlugin('docshelf').server.origin);
  await page.evaluate(() => app.plugins.disablePlugin('docshelf'));
  await poll(async () => { try { await fetch(origin); return false; } catch { return true; } }, 'Loopback listener did not close on unload.');
  assert.equal(await readFile(guidePath, 'utf8'), watchedGuide);
  assert.deepEqual(pageErrors, []);
  console.log('Unload cleanup and source preservation passed.');
  await writeFile('.local/runtime/results.json', JSON.stringify({ bundle: bundles[0], passed: true, packageMode, pluginVersion: manifest.version, probes, permalink, pageErrors }, null, 2));
} catch (error) {
  if (page) { await page.screenshot({ path: '.local/runtime/failure.png' }).catch(() => {}); }
  if (page) console.error('Plugin state:', await page.evaluate(() => {
    const plugin = app.plugins.getPlugin('docshelf');
    return { error: plugin?.error, artifacts: plugin?.catalog?.artifacts, watched: plugin?.watcher?.getWatched() };
  }).catch(() => null));
  console.error('Runtime test failed:', error.stack);
  console.error('Page errors:', pageErrors);
  console.error('Log: .local/runtime/obsidian.log');
  process.exitCode = 1;
} finally {
  for (const dispatch of dispatchProcesses) dispatch.kill('SIGKILL');
  child.kill('SIGKILL');
  await browser?.close().catch(() => {});
  await new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    const timer = setTimeout(resolve, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  log.end();
  if (process.env.DOCSHELF_KEEP_TEST_PROFILE) console.log(`Test profile: ${root}`);
  else await rm(root, { recursive: true, force: true, maxRetries: 3 });
}
