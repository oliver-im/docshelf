import { prepareAddition, addToShelf, prepareRemoval, removeFromShelf, prepareProjectRemoval, removeProjectFromShelf, prepareFolderRemoval, removeFolderFromShelf } from '../packages/local/shelf.mjs';
import { docShelfRoot, defaultShelfPath, localShelfPath, resolveShelfPath, resolveSourceRoots } from './artifacts.mjs';

export function createRegistrationHandler({ root = docShelfRoot, getShelfPath = resolveShelfPath, getRoots = resolveSourceRoots, fallback = defaultShelfPath, local = localShelfPath } = {}) {
  return async body => {
    const removing = body && ['remove-preview', 'remove'].includes(body.action);
    const keys = removing ? ['action', 'route', 'project', 'folder', 'revision'] : ['action', 'sources', 'project', 'title', 'revision'];
    if (!body || !['preview', 'add', 'remove-preview', 'remove'].includes(body.action) || Object.keys(body).some(key => !keys.includes(key)) || removing && ((body.route === undefined) === (body.project === undefined) || body.folder !== undefined && body.project === undefined)) throw new Error('Send a registration request with selected paths, or a registered route, project, or project folder to remove.');
    const current = await getShelfPath();
    const shelfPath = current === fallback ? local : current;
    const roots = await getRoots();
    const options = { shelfPath, base: root, roots: [roots.workspace, roots.checkout], sources: body.sources, project: body.project || '', title: body.title || '', relativeOnly: true };
    if (removing && body.folder !== undefined) {
      const removal = { ...options, project: body.project, folder: body.folder };
      if (body.action === 'remove') return removeFolderFromShelf(removal, body.revision);
      const result = await prepareFolderRemoval(removal);
      return { revision: result.revision, title: result.title, documents: result.documents, folders: result.folders, foldersExcluded: result.foldersExcluded };
    }
    if (removing && body.project !== undefined) {
      const removal = { ...options, project: body.project };
      if (body.action === 'remove') return removeProjectFromShelf(removal, body.revision);
      const result = await prepareProjectRemoval(removal);
      return { revision: result.revision, title: result.title, documents: result.documents, folders: result.folders, foldersExcluded: result.foldersExcluded };
    }
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
