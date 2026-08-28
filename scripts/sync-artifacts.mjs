import { loadArtifactManifest, syncArtifacts } from './artifacts.mjs';

const manifest = await loadArtifactManifest();
await syncArtifacts(manifest);

console.log(`Synchronized ${manifest.artifacts.length} artifacts.`);
