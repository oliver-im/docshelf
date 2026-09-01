// @ts-check
import path from 'node:path';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import {
  docShelfRoot,
  artifactBuildIntegration,
  artifactSearchIntegration,
  artifactUrl,
  loadArtifactManifest,
} from './scripts/artifacts.mjs';

const manifest = await loadArtifactManifest();
const configuredOutput = process.env.DOCSHELF_WATCH_OUT_DIR;
const outDir = configuredOutput ? path.resolve(configuredOutput) : undefined;
const host = process.env.DOCSHELF_HOST || '127.0.0.1';
const port = Number(process.env.DOCSHELF_PORT || 4321);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('DOCSHELF_PORT must be an integer between 1 and 65535.');
}

const siteHost =
  host === '127.0.0.1' ? 'shelf.localhost' : host.includes(':') ? `[${host}]` : host;
const site = `http://${siteHost}:${port}`;

if (outDir) {
  const runtimeRoot = path.join(docShelfRoot, '.docshelf-runtime');
  const relativeOutput = path.relative(runtimeRoot, outDir);
  if (
    relativeOutput === '' ||
    relativeOutput === '..' ||
    relativeOutput.startsWith(`..${path.sep}`)
  ) {
    throw new Error('DOCSHELF_WATCH_OUT_DIR must be a child of DocShelf .docshelf-runtime.');
  }
}
const sidebar = Array.from(
  Map.groupBy(manifest.artifacts, (artifact) => artifact.project),
  ([label, artifacts]) => ({
    label,
    items: artifacts.map((artifact) => ({
      label: artifact.title,
      link: artifactUrl(artifact),
    })),
  }),
);

export default defineConfig({
  site,
  outDir,
  build: {
    format: 'file',
  },
  integrations: [
    artifactBuildIntegration(manifest),
    starlight({
      title: 'DocShelf',
      sidebar,
      components: {
        SiteTitle: './src/components/DocShelfSiteTitle.astro',
      },
    }),
    artifactSearchIntegration(),
  ],
});
