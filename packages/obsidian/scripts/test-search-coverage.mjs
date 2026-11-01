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
  const warning = page.getByRole('button', { name: 'Review search coverage', exact: true });
  try {
    await writeFile(shelfPath, JSON.stringify({ ...shelf, artifacts: [...shelf.artifacts, ...artifacts] }));
    await poll(() => page.evaluate(() => app.plugins.getPlugin('docshelf').search.coverage.limited === 2), 'The total search budget did not limit the last two documents.', 60_000);
    const coverage = await page.evaluate(() => app.plugins.getPlugin('docshelf').search.coverage);
    assert.deepEqual(coverage, { total: shelf.artifacts.length + 85, indexed: shelf.artifacts.length + 83, partial: 1, limited: 2 });
    assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').error), '', 'A search limit must not become a shelf error.');
    assert.equal(await page.locator('.docshelf-status.docshelf-error').count(), 0);
    assert.match(await warning.textContent(), /1 shortened/);
    await page.locator('.docshelf-search').fill('omittedmetadata');
    await poll(async () => await page.locator('.docshelf-item').count() === 1, 'A limited document lost its metadata search.');
    assert.equal(await page.evaluate(() => app.plugins.getPlugin('docshelf').search.search('qzxvplimitedbody').length), 0);
    await warning.click();
    const modal = page.locator('.modal').filter({ hasText: 'Search coverage' });
    assert.equal(await modal.locator('.docshelf-search-coverage-item').count(), 3);
    assert.match(await modal.textContent(), /budget-84.md/);
    assert.match(await modal.textContent(), /Metadata only: the shelf content budget is full/);
    assert.match(await modal.textContent(), /First 200,000 text characters indexed/);
    await page.screenshot({ path: '.local/runtime/search-coverage.png' });
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    // Removing the other large documents must restore the omitted body's search on the next refresh.
    await writeFile(shelfPath, JSON.stringify({ ...shelf, artifacts: [...shelf.artifacts, artifacts[84]] }));
    await poll(() => page.evaluate(() => app.plugins.getPlugin('docshelf').search.search('qzxvplimitedbody').length === 1), 'Freed space did not restore content search.');
    await poll(async () => !(await warning.isVisible()), 'Complete coverage did not clear the warning.');
    console.log('Search budget coverage, metadata fallback, shortened text, review list, and recovery passed.');
  } finally {
    await writeFile(shelfPath, baseline);
    await page.evaluate(() => app.plugins.getPlugin('docshelf').refresh());
    await page.locator('.docshelf-search').fill('');
    await rm(folder, { recursive: true, force: true });
  }
}
