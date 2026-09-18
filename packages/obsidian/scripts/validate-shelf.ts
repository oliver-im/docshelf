import path from 'node:path';
import { loadCatalog } from '../src/core/catalog';
import { createPermalink } from '../src/core/protocol';

const args = process.argv.slice(2);
const shelf = args[0];
function option(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
  return args[index + 1];
}
try {
  if (!shelf || shelf.startsWith('--')) throw new Error('Usage: npm run validate:shelf -- /path/to/shelf.json [--workspace /path] [--vault name-or-id]');
  const catalog = await loadCatalog(path.resolve(shelf), option('--workspace'));
  const vault = option('--vault');
  console.log(JSON.stringify({
    shelf: catalog.shelfPath,
    documents: catalog.artifacts.map(artifact => ({ title: artifact.title, kind: artifact.kind, source: artifact.sourcePath || artifact.source, route: artifact.route, ...(vault ? { url: createPermalink(vault, artifact, null) } : {}) })),
  }, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
