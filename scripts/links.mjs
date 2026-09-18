import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createBrowserLink, createObsidianLink, createSourceReference } from '@docshelf/core/links';
import { parseLineFragment } from '@docshelf/core/line-permalinks';
import { docShelfRoot, loadShelf } from './artifacts.mjs';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { site: { type: 'string' }, vault: { type: 'string' }, lines: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log('Usage: npm run links -- <registered-route-or-source> --site <browser-site> [--vault <name-or-id>] [--lines 7-11]\nPrints links from this checkout\'s shelf without changing it or starting either app. DOCSHELF_SITE can supply --site.');
  } else {
    if (positionals.length !== 1) throw new Error('Supply one registered route or source. Use --help for usage.');
    const site = values.site || process.env.DOCSHELF_SITE;
    if (!site) throw new Error('Supply --site (for example https://shelf.localhost/) or DOCSHELF_SITE so links use your installed address.');
    let range = null;
    if (values.lines !== undefined) {
      const match = /^([1-9]\d*)(?:-([1-9]\d*))?$/.exec(values.lines);
      range = match && parseLineFragment(`#L${match[1]}${match[2] ? `-L${match[2]}` : ''}`);
      if (!range) throw new Error('Line range must look like 7 or 7-11 with ordered, positive safe integers.');
    }
    const requested = positionals[0];
    const canonical = await realpath(path.resolve(docShelfRoot, requested)).catch(() => null);
    const shelf = await loadShelf();
    const matches = shelf.artifacts.filter(artifact => artifact.route === requested || artifact.source === requested || (canonical && artifact.sourcePath === canonical));
    if (matches.length !== 1) throw new Error(matches.length ? 'Ambiguous source; use its unique route.' : 'That document is not registered in this checkout\'s shelf.');
    const artifact = matches[0];
    if (range && artifact.format !== 'markdown') throw new Error('Shared source-line links require a Markdown document.');
    const source = artifact.sourcePath || artifact.source;
    console.log(JSON.stringify({
      title: artifact.title,
      route: artifact.route,
      browser: createBrowserLink(site, artifact.route, range),
      ...(values.vault ? { obsidian: createObsidianLink(values.vault, source, range) } : {}),
      source: createSourceReference(source, Boolean(artifact.sourcePath), range),
    }, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
