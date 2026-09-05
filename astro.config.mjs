// @ts-check
import path from 'node:path';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import {
  artifactBuildIntegration,
  artifactFileName,
  artifactSearchIntegration,
  artifactUrl,
  docshelfBasePath,
  loadShelf,
  runtimeRoot,
} from './scripts/artifacts.mjs';
import { browserHost } from './scripts/server-security.mjs';

const shelf = await loadShelf();
const configuredOutput = process.env.DOCSHELF_WATCH_OUT_DIR;
const outDir = configuredOutput ? path.resolve(configuredOutput) : undefined;
const host = process.env.DOCSHELF_HOST || '127.0.0.1';
const port = Number(process.env.DOCSHELF_PORT || 4321);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('DOCSHELF_PORT must be an integer between 1 and 65535.');
}

const site = process.env.DOCSHELF_SITE || `http://${browserHost(host)}:${port}`;

if (outDir) {
  const relativeOutput = path.relative(runtimeRoot, outDir);
  if (
    relativeOutput === '' ||
    relativeOutput === '..' ||
    relativeOutput.startsWith(`..${path.sep}`)
  ) {
    throw new Error('DOCSHELF_WATCH_OUT_DIR must be a child of DocShelf .docshelf-runtime.');
  }
}
const shelfGroups = Array.from(
  Map.groupBy(shelf.artifacts, (artifact) => artifact.project),
  ([label, artifacts]) => ({
    label,
    items: artifacts.map((artifact) => ({
      label: artifactFileName(artifact),
      link: artifactUrl(artifact),
    })),
  }),
);
// Keep the navigation shell available when a hosted shelf starts empty so
// browser-imported documents still have somewhere to appear.
const sidebar = shelfGroups.length > 0 ? shelfGroups : [{ label: 'Shelf', items: [] }];

export default defineConfig({
  site,
  base: docshelfBasePath,
  outDir,
  build: {
    format: 'file',
  },
  integrations: [
    artifactBuildIntegration(shelf),
    starlight({
      title: 'DocShelf',
      sidebar,
      components: {
        Hero: './src/components/DocShelfHero.astro',
        SiteTitle: './src/components/DocShelfSiteTitle.astro',
      },
    }),
    artifactSearchIntegration(),
  ],
});
