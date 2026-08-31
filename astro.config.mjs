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
  site: 'http://shelf.localhost:4321',
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
