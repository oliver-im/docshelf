import { loadShelf, syncArtifacts } from './artifacts.mjs';

const shelf = await loadShelf();
await syncArtifacts(shelf);

console.log(`Synchronized ${shelf.artifacts.length} artifacts.`);
