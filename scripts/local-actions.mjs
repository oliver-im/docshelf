import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { isWithinSourceRoots, resolveSourceRoots } from './artifacts.mjs';
import { isAllowedHostHeader, isLoopbackHost } from './server-security.mjs';

const runFile = promisify(execFile);
const capabilitiesPath = '/__docshelf/local-actions';
const revealPath = '/__docshelf/reveal';
const registerPath = '/__docshelf/register';
const eventsPath = '/__docshelf/events';

/** Local OS actions are available only through the loopback watcher, never static output. */
export function createLocalActionsHandler({
  listenHost,
  loadShelf,
  workspaceRoot,
  platform = process.platform,
  revealFile = (file) => runFile('/usr/bin/open', ['-R', file], { timeout: 5000 }),
  registration,
  announcements,
}) {
  const token = randomBytes(32).toString('hex');
  let revealing = false;

  return async function handleLocalAction(request, response, pathname) {
    if (pathname !== capabilitiesPath && pathname !== revealPath && pathname !== registerPath && pathname !== eventsPath) return false;

    const reply = (status, body) => {
      response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.end(JSON.stringify(body));
      return true;
    };
    const remoteAddress = request.socket.remoteAddress?.replace(/^::ffff:/, '') || '';
    const forwardedFor = request.headers['x-forwarded-for'];
    const localProxyChain = forwardedFor === undefined || (typeof forwardedFor === 'string' &&
      forwardedFor.split(',').every((address) => isLoopbackHost(address.trim().replace(/^::ffff:/, ''))));
    if (
      !isLoopbackHost(listenHost) || !isLoopbackHost(remoteAddress) || !localProxyChain ||
      !isAllowedHostHeader(request.headers.host, listenHost) ||
      request.headers['x-docshelf-request'] !== 'document-actions' ||
      (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')
    ) return reply(403, { error: 'Document actions are available only from the local DocShelf interface.' });

    if (pathname === capabilitiesPath) {
      if (request.method !== 'GET') return reply(405, { error: 'Use GET for document capabilities.' });
      return reply(200, { revealInFinder: platform === 'darwin', ...(platform === 'darwin' || registration ? { token } : {}), ...(registration ? { add: true, remove: true } : {}) });
    }

    // Read-only: announced updates arrive as opaque source IDs after a log position.
    if (pathname === eventsPath) {
      if (request.method !== 'GET') return reply(405, { error: 'Use GET for announced updates.' });
      if (!announcements) return reply(404, { error: 'Announced updates are unavailable on this server.' });
      const query = new URL(request.url || '/', 'http://shelf.localhost').searchParams;
      const after = query.get('after');
      const last = query.get('last');
      if (
        [...query.keys()].some((key) => key !== 'after' && key !== 'last') ||
        (after !== null && (!/^\d{1,16}$/.test(after) || !Number.isSafeInteger(Number(after)))) ||
        (last !== null && (after === null || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(last)))
      ) return reply(400, { error: 'Send a position in the event log.' });
      try {
        const result = await announcements({ after: after === null ? undefined : Number(after), last: last ?? undefined });
        return result ? reply(200, result) : reply(503, { error: 'DocShelf is building.' });
      } catch {
        return reply(500, { error: 'Could not read announced updates.' });
      }
    }

    if (request.method !== 'POST') return reply(405, { error: 'Use POST for document actions.' });
    if (pathname === revealPath && platform !== 'darwin') return reply(404, { error: 'Reveal in Finder is unavailable on this server.' });
    if (pathname === registerPath && !registration) return reply(404, { error: 'Adding local sources is unavailable on this server.' });
    if (
      // A local HTTPS proxy may terminate TLS before forwarding to this HTTP watcher.
      !['http:', 'https:'].some((scheme) => request.headers.origin === `${scheme}//${request.headers.host}`) ||
      request.headers['x-docshelf-token'] !== token ||
      request.headers['content-type']?.split(';')[0].trim() !== 'application/json'
    ) return reply(403, { error: 'Reload DocShelf and try again.' });

    let body;
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > (pathname === registerPath ? 65536 : 4096)) return reply(413, { error: 'Document action request is too large.' });
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return reply(400, { error: 'Send a document route as JSON.' });
    }
    if (pathname === registerPath) {
      try { return reply(200, await registration(body)); }
      catch (error) { return reply(400, { error: error.message || 'Could not update the shelf.' }); }
    }
    if (!body || typeof body.route !== 'string' || Object.keys(body).length !== 1) {
      return reply(400, { error: 'Send only a registered document route.' });
    }
    if (revealing) return reply(409, { error: 'Finder is still opening. Try again in a moment.' });

    revealing = true;
    try {
      let shelf;
      try {
        shelf = await loadShelf();
      } catch {
        return reply(409, { error: 'Could not read the current shelf. Check the watcher status.' });
      }
      const artifact = shelf.artifacts.find((entry) => entry.route === body.route);
      if (!artifact) return reply(404, { error: 'This document is no longer registered.' });
      if (!artifact.sourcePath || !['html', 'markdown'].includes(artifact.format)) {
        return reply(400, { error: 'This document has no local source file.' });
      }

      // Recheck the real file at action time against the same roots as the shelf
      // loader; never accept a browser-supplied path.
      const source = await realpath(artifact.sourcePath).catch(() => null);
      const roots = await resolveSourceRoots(workspaceRoot);
      if (!source || !isWithinSourceRoots(roots, source)) {
        return reply(409, { error: 'The source file is unavailable or outside the workspace.' });
      }
      if (!(await stat(source)).isFile()) return reply(409, { error: 'The source is no longer a file.' });
      await revealFile(source);
      return reply(200, { revealed: true });
    } catch {
      return reply(500, { error: 'Could not reveal the source file in Finder.' });
    } finally {
      revealing = false;
    }
  };
}
