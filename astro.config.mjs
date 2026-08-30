// @ts-check
import path from 'node:path';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import {
  atlasRoot,
  artifactBuildIntegration,
  artifactSearchIntegration,
  artifactUrl,
  loadArtifactManifest,
} from './scripts/artifacts.mjs';

const manifest = await loadArtifactManifest();
const configuredOutput = process.env.ATLAS_WATCH_OUT_DIR;
const outDir = configuredOutput ? path.resolve(configuredOutput) : undefined;

if (outDir) {
  const runtimeRoot = path.join(atlasRoot, '.atlas-runtime');
  const relativeOutput = path.relative(runtimeRoot, outDir);
  if (
    relativeOutput === '' ||
    relativeOutput === '..' ||
    relativeOutput.startsWith(`..${path.sep}`)
  ) {
    throw new Error('ATLAS_WATCH_OUT_DIR must be a child of Atlas .atlas-runtime.');
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
  site: 'http://127.0.0.1:4321',
  outDir,
  build: {
    format: 'file',
  },
  integrations: [
    artifactBuildIntegration(manifest),
    starlight({
      title: 'Atlas',
      sidebar,
      components: {
        SiteTitle: './src/components/AtlasSiteTitle.astro',
      },
    }),
    artifactSearchIntegration(),
  ],
});
