// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import {
  artifactBuildIntegration,
  artifactSearchIntegration,
  artifactUrl,
  loadArtifactManifest,
} from './scripts/artifacts.mjs';

const manifest = await loadArtifactManifest();
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
  build: {
    format: 'file',
  },
  integrations: [
    artifactBuildIntegration(manifest),
    starlight({
      title: 'Atlas',
      sidebar,
    }),
    artifactSearchIntegration(),
  ],
});
