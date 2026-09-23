import { prepareAddition, addToShelf, prepareRemoval, removeFromShelf } from '../packages/local/shelf.mjs';
import { docShelfRoot, defaultShelfPath, localShelfPath, resolveShelfPath, resolveSourceRoots } from './artifacts.mjs';

export function createRegistrationHandler({ root = docShelfRoot, getShelfPath = resolveShelfPath, getRoots = resolveSourceRoots, fallback = defaultShelfPath, local = localShelfPath } = {}) {
  return async body => {
    const removing = body && ['remove-preview', 'remove'].includes(body.action);
    const keys = removing ? ['action', 'route', 'revision'] : ['action', 'sources', 'project', 'title', 'revision'];
    if (!body || !['preview', 'add', 'remove-preview', 'remove'].includes(body.action) || Object.keys(body).some(key => !keys.includes(key))) throw new Error('Send a registration request with selected paths, or a registered route to remove.');
    const current = await getShelfPath();
    const shelfPath = current === fallback ? local : current;
    const roots = await getRoots();
    const options = { shelfPath, base: root, roots: [roots.workspace, roots.checkout], sources: body.sources, project: body.project || '', title: body.title || '', relativeOnly: true };
    if (removing) {
      const removal = { ...options, route: body.route };
      if (body.action === 'remove') return removeFromShelf(removal, body.revision);
      const result = await prepareRemoval(removal);
      return { revision: result.revision, title: result.title, foldersExcluded: result.foldersExcluded };
    }
    if (body.action === 'add') return addToShelf(options, body.revision);
    const result = await prepareAddition(options);
    return { revision: result.revision, documents: result.documents, moved: result.moved, foldersAdded: result.foldersAdded, warnings: result.warnings };
  };
}
