import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

export async function testSearchCoverage({ page, poll, workspace, shelfPath }) {
  const baseline = await readFile(shelfPath, 'utf8');
  const shelf = JSON.parse(baseline);
  const folder = path.join(workspace, 'search-budget');
  await mkdir(folder);
  const artifacts = [];
  for (let index = 0; index < 85; index++) {
    const source = path.join(folder, `budget-${index}.md`);
    const text = (`${index === 84 ? 'qzxvplimitedbody' : `searchmarker${index}`} ` + 'orchard '.repeat(25_000)).slice(0, 199_999) + 'z';
    await writeFile(source, text + (index === 0 ? ' Afterthecutoff' : ''));
    artifacts.push({ source, route: `budget-${index}.html`, title: `Budget document ${index}`, project: 'Search budget', description: index === 84 ? 'omittedmetadata' : `metadatamarker${index}` });
  }
  const warning = page.locator('.docshelf-search-coverage');
  try {
    await writeFile(shelfPath, JSON.stringify({ ...shelf, artifacts: [...shelf.artifacts, ...artifacts] }));
    await poll(() => page.evaluate(() => app.plugins.getPlugin('docshelf').search.coverage.limited === 2), 'The total search budget did not limit the last two documents.', 60_000);
    const coverage = await page.evaluate(() => app.plugins.getPlugin('docshelf').search.coverage);
    assert.deepEqual(coverage, { total: shelf.artifacts.length + 85, indexed: shelf.artifacts.length + 83, partial: 1, limited: 2 });
    assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').error), '', 'A search limit must not become a shelf error.');
    assert.equal(await page.locator('.docshelf-status.docshelf-error').count(), 0);
    assert.equal(await warning.count(), 0, 'Search diagnostics must not take space while browsing.');
    await page.locator('.docshelf-search').fill('omittedmetadata');
    await poll(async () => await page.locator('.docshelf-item').count() === 1, 'A limited document lost its metadata search.');
    assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').search.search('qzxvplimitedbody').length), 0);
    assert.match(await warning.textContent(), /Limited text search/);
    assert.match(await warning.getAttribute('title'), /1 long document: only the first 200,000 text characters/);
    assert.match(await warning.getAttribute('title'), /2 documents: text exceeds/);
    assert.equal(await warning.getAttribute('aria-label'), await warning.getAttribute('title'));
    await page.screenshot({ path: '.local/runtime/search-coverage.png' });
    await page.locator('.docshelf-search').fill('');
    assert.equal(await warning.count(), 0, 'Clearing search must remove its diagnostic note.');
    await page.locator('.docshelf-search').fill('qzxvplimitedbody');
    // Removing the other large documents must restore the omitted body's search on the next refresh.
    await writeFile(shelfPath, JSON.stringify({ ...shelf, artifacts: [...shelf.artifacts, artifacts[84]] }));
    await poll(() => page.evaluate(() => app.plugins.getPlugin('docshelf').search.search('qzxvplimitedbody').length === 1), 'Freed space did not restore content search.');
    await poll(async () => !(await warning.isVisible()), 'Complete coverage did not clear the warning.');
    console.log('Search budget coverage, metadata fallback, compact search-only diagnostics, and recovery passed.');
  } finally {
    await writeFile(shelfPath, baseline);
    await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
    await page.locator('.docshelf-search').fill('');
    await rm(folder, { recursive: true, force: true });
  }
}
