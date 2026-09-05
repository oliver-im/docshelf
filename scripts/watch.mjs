import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import chokidar from 'chokidar';
import {
  artifactSourcesMatch,
  docShelfRoot,
  defaultShelfPath,
  loadShelf,
  localShelfPath,
  legacyLocalShelfPath,
  runtimeRoot,
  syncArtifacts,
} from './artifacts.mjs';
import { BuildStatusReporter, buildStatusRoute } from './build-status.mjs';
import { browserHost, isAllowedHostHeader } from './server-security.mjs';
import { siteInputsSignature } from './site-inputs.mjs';
import { cacheControl, entityTag, isFresh } from './static-headers.mjs';
import {
  acquireSyncLock,
  acquireWatcherLock,
  describeLockOwner,
  installShutdownSignals,
} from './watcher-lock.mjs';

const host = process.env.DOCSHELF_HOST || '127.0.0.1';
const port = Number(process.env.DOCSHELF_PORT || 4321);
const standardBuildRoot = path.join(docShelfRoot, 'dist');
const astroCli = path.join(docShelfRoot, 'node_modules', 'astro', 'bin', 'astro.mjs');
const verboseBuilds = process.env.DOCSHELF_VERBOSE === '1';
const buildStatus = new BuildStatusReporter(runtimeRoot);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('DOCSHELF_PORT must be an integer between 1 and 65535.');
}

let watcherLock;
try {
  watcherLock = await acquireWatcherLock(runtimeRoot);
} catch (error) {
  if (typeof error?.code === 'string' && error.code.startsWith('DOCSHELF_LOCK_')) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

// Release on every exit path from here on: the 'exit' handler covers uncaught errors and forced
// exits, the signal handlers run a graceful shutdown that releases as soon as this process can no
// longer touch the runtime directories.
let syncLock = null;
const shutdownController = new AbortController();
process.on('exit', releaseLocks);
installShutdownSignals(shutdown, {
  onError: (error) => console.error(`[shutdown] ${formatError(error)}`),
});

let activeBuildRoot = null;
let activeArtifactRevisions = new Map();
let currentBuildProcess = null;
let activeDrain = null;
let buildRequested = false;
let building = false;
let debounceTimer;
let shuttingDown = false;
let buildSequence = 0;
const pendingReasons = new Set();
const watchedSources = new Set();

const watcher = chokidar.watch([defaultShelfPath, localShelfPath, legacyLocalShelfPath], {
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 200,
    pollInterval: 50,
  },
});

watcher.on('all', (event, changedPath) => {
  scheduleBuild(`${event} ${path.relative(docShelfRoot, changedPath)}`);
});

watcher.on('error', (error) => {
  console.error(`[watch] ${formatError(error)}`);
});

activeBuildRoot = await findLatestBuild();
await reportBuildStatus(buildStatus.starting(Boolean(activeBuildRoot)));

const server = createServer((request, response) => {
  serveRequest(request, response).catch((error) => {
    console.error(`[server] ${formatError(error)}`);
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }
    response.end('Internal server error\n');
  });
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, host, () => {
    server.off('error', reject);
    resolve();
  });
});

console.log(`DocShelf is available at http://${browserHost(host)}:${port}/`);
if (activeBuildRoot) {
  console.log(`[serve] Using ${path.relative(docShelfRoot, activeBuildRoot)} while rebuilding.`);
} else {
  console.log('[serve] No successful build yet; requests will return 503 until one completes.');
}

await refreshSourceWatches().catch((error) => {
  console.error(`[watch] Could not load initial sources: ${formatError(error)}`);
});
scheduleBuild('startup', 0);

function scheduleBuild(reason, delay = 300) {
  pendingReasons.add(reason);
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void drainBuildQueue(), delay);
}

async function drainBuildQueue() {
  buildRequested = true;
  if (building || shuttingDown) return;

  building = true;
  let finished;
  activeDrain = new Promise((resolve) => {
    finished = resolve;
  });
  try {
    while (buildRequested && !shuttingDown) {
      buildRequested = false;
      const reasons = Array.from(pendingReasons);
      pendingReasons.clear();
      await rebuild(reasons);
    }
  } finally {
    building = false;
    activeDrain = null;
    finished();
  }
}

async function rebuild(reasons) {
  const buildName = `build-${Date.now()}-${++buildSequence}`;
  const buildRoot = path.join(runtimeRoot, buildName);
  const startedAt = performance.now();
  await reportBuildStatus(buildStatus.building(reasons, Boolean(activeBuildRoot)));
  console.log(`[build] ${reasons.join(', ') || 'change detected'}`);

  try {
    // Hold the sync lock for the whole rebuild so `npm run sync`, `build`, `check`, `dev`, and
    // `preview` cannot replace public/artifacts or delete this build's artifact root mid-build.
    syncLock = await acquireSyncLock(runtimeRoot, {
      signal: shutdownController.signal,
      onWait: (owner) => {
        console.log(`[build] Waiting for ${describeLockOwner(owner)} to finish synchronizing.`);
      },
    });
    // A signal that arrived while waiting for the lock must not start a sync or a build now.
    throwIfShuttingDown();
    const shelf = await loadShelf();
    const revisionState = await syncArtifacts(shelf, { lock: false });
    await rm(buildRoot, { recursive: true, force: true });
    throwIfShuttingDown();

    const siteSignature = await siteInputsSignature(docShelfRoot);
    const { exitCode, output } = await runAstroBuild(buildRoot);
    if (exitCode !== 0) {
      process.stderr.write(output);
      if (!(await artifactSourcesMatch(shelf, revisionState))) {
        requestFreshBuild('registered source changed during build');
      }
      throw Object.assign(new Error(`Astro exited with code ${exitCode}.`), { details: output });
    }

    if (!(await isSuccessfulBuild(buildRoot))) {
      throw new Error('The build did not produce index.html.');
    }
    if (!(await artifactSourcesMatch(shelf, revisionState))) {
      requestFreshBuild('registered source changed during build');
      throw new Error('Registered sources changed during the build.');
    }

    await refreshSourceWatches(shelf);
    if ((await siteInputsSignature(docShelfRoot)) !== siteSignature) {
      requestFreshBuild('DocShelf site files changed during build');
      throw new Error('DocShelf site files changed during the build.');
    }

    const previousBuildRoot = activeBuildRoot;
    activeBuildRoot = buildRoot;
    activeArtifactRevisions = new Map(
      revisionState.artifacts.map((artifact) => [artifact.route, artifact.revision]),
    );
    await reportBuildStatus(buildStatus.ready(true));
    const seconds = ((performance.now() - startedAt) / 1000).toFixed(2);
    console.log(`[build] Published ${shelf.artifacts.length} artifacts in ${seconds}s.`);

    if (previousBuildRoot && isWithin(runtimeRoot, previousBuildRoot)) {
      setTimeout(() => {
        void rm(previousBuildRoot, { recursive: true, force: true }).catch((error) => {
          console.error(`[cleanup] ${formatError(error)}`);
        });
      }, 5_000).unref();
    }
  } catch (error) {
    await rm(buildRoot, { recursive: true, force: true });
    if (shuttingDown) {
      console.log('[build] Stopped by shutdown.');
    } else {
      await reportBuildStatus(buildStatus.failed(error, Boolean(activeBuildRoot)));
      console.error(`[build] Failed; continuing to serve the previous build. ${formatError(error)}`);
    }
  } finally {
    releaseSyncLock();
  }
}

function throwIfShuttingDown() {
  if (shuttingDown) throw new Error('The watcher is shutting down.');
}

function requestFreshBuild(reason) {
  pendingReasons.add(reason);
  buildRequested = true;
}

/**
 * Run `astro build` into `buildRoot`. Astro's output is collected instead of streamed so a
 * successful build adds one line to the log rather than a screenful; the collected output is
 * printed when the build fails. `DOCSHELF_VERBOSE=1` streams it as it happens.
 *
 * @param {string} buildRoot
 * @returns {Promise<{ exitCode: number, output: string }>}
 */
function runAstroBuild(buildRoot) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    currentBuildProcess = spawn(process.execPath, [astroCli, 'build'], {
      cwd: docShelfRoot,
      env: {
        ...process.env,
        DOCSHELF_WATCH_OUT_DIR: buildRoot,
      },
      stdio: verboseBuilds ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });

    currentBuildProcess.stdout?.on('data', (chunk) => chunks.push(chunk));
    currentBuildProcess.stderr?.on('data', (chunk) => chunks.push(chunk));
    currentBuildProcess.once('error', reject);
    // 'close' rather than 'exit': the output streams have ended by then.
    currentBuildProcess.once('close', (code, signal) => {
      currentBuildProcess = null;
      if (signal && !shuttingDown) {
        reject(new Error(`Astro was terminated by ${signal}.`));
        return;
      }
      resolve({ exitCode: code ?? 1, output: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

async function refreshSourceWatches(existingShelf) {
  const shelf = existingShelf || (await loadShelf());
  const nextSources = new Set(
    shelf.artifacts.flatMap((artifact) =>
      artifact.sourcePath ? [artifact.sourcePath] : [],
    ),
  );

  for (const sourcePath of watchedSources) {
    if (!nextSources.has(sourcePath)) {
      watcher.unwatch(sourcePath);
      watchedSources.delete(sourcePath);
    }
  }

  for (const sourcePath of nextSources) {
    if (!watchedSources.has(sourcePath)) {
      watcher.add(sourcePath);
      watchedSources.add(sourcePath);
    }
  }
}

async function findLatestBuild() {
  const runtimeEntries = await readdir(runtimeRoot, { withFileTypes: true });
  const candidates = runtimeEntries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('build-'))
    .map((entry) => path.join(runtimeRoot, entry.name))
    .sort()
    .reverse();

  let latestBuild = null;
  for (const candidate of candidates) {
    if (!latestBuild && (await isSuccessfulBuild(candidate))) {
      latestBuild = candidate;
      continue;
    }
    await rm(candidate, { recursive: true, force: true });
  }

  if (latestBuild) return latestBuild;
  return (await isSuccessfulBuild(standardBuildRoot)) ? standardBuildRoot : null;
}

/** @param {string} buildRoot */
async function isSuccessfulBuild(buildRoot) {
  const indexStats = await stat(path.join(buildRoot, 'index.html')).catch(() => null);
  return Boolean(indexStats?.isFile());
}

async function serveRequest(request, response) {
  if (!isAllowedHostHeader(request.headers.host, host)) {
    response.writeHead(421, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Misdirected request\n');
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, {
      allow: 'GET, HEAD',
      'content-type': 'text/plain; charset=utf-8',
    });
    response.end('Method not allowed\n');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', 'http://shelf.localhost').pathname);
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Bad request\n');
    return;
  }

  if (pathname === buildStatusRoute) {
    await serveBuildStatus(request, response);
    return;
  }

  const buildRoot = activeBuildRoot;
  const artifactRevisions = activeArtifactRevisions;
  if (!buildRoot) {
    response.writeHead(503, {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': '1',
    });
    response.end('DocShelf is building\n');
    return;
  }

  const requestPath = pathname.replace(/^\/+/, '') || 'index.html';
  let filePath = path.resolve(buildRoot, requestPath);

  // The URL parser collapses every `..` a browser would send; one survives only behind a
  // percent-encoded slash, so refuse it rather than serve a file under a misleading name.
  if (requestPath.split('/').includes('..') || !isWithin(buildRoot, filePath)) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Forbidden\n');
    return;
  }

  let fileStats = await stat(filePath).catch(() => null);
  if (fileStats?.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    fileStats = await stat(filePath).catch(() => null);
  }

  if (!fileStats?.isFile()) {
    const notFoundPath = path.join(buildRoot, '404.html');
    const notFoundStats = await stat(notFoundPath).catch(() => null);
    if (notFoundStats?.isFile()) {
      await sendFile(request, response, notFoundPath, notFoundStats, {
        statusCode: 404,
        cacheControl: 'no-cache',
      });
    } else {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found\n');
    }
    return;
  }

  // Classify the file being served rather than the request: the two differ once `.` segments are
  // collapsed or a directory falls through to its index.html.
  const servedPath = path.relative(buildRoot, filePath).split(path.sep).join('/');
  await sendFile(request, response, filePath, fileStats, {
    statusCode: 200,
    cacheControl: cacheControl(servedPath),
    contentRevision: servedPath.startsWith('artifacts/')
      ? artifactRevisions.get(servedPath.slice('artifacts/'.length))
      : undefined,
  });
}

async function serveBuildStatus(request, response) {
  const contents = await readFile(buildStatus.filePath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!contents) {
    response.writeHead(503, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'retry-after': '1',
      'x-content-type-options': 'nosniff',
    });
    response.end('{"error":"Build status is not available."}\n');
    return;
  }

  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-length': contents.length,
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : contents);
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {string} filePath
 * @param {import('node:fs').Stats} fileStats
 * @param {{ statusCode: number, cacheControl: string, contentRevision?: string }} options
 */
async function sendFile(request, response, filePath, fileStats, options) {
  const etag = entityTag(fileStats, options.contentRevision);
  const headers = {
    'cache-control': options.cacheControl,
    etag,
    'x-content-type-options': 'nosniff',
  };

  if (options.statusCode === 200 && isFresh(request.headers, etag)) {
    response.writeHead(304, headers);
    response.end();
    return;
  }

  response.writeHead(options.statusCode, {
    ...headers,
    'content-length': fileStats.size,
    'content-type': contentType(filePath),
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  try {
    await pipeline(createReadStream(filePath), response);
  } catch (error) {
    if (error?.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw error;
  }
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      '.css': 'text/css; charset=utf-8',
      '.gif': 'image/gif',
      '.html': 'text/html; charset=utf-8',
      '.ico': 'image/x-icon',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.txt': 'text/plain; charset=utf-8',
      '.wasm': 'application/wasm',
      '.webp': 'image/webp',
      '.xml': 'application/xml; charset=utf-8',
    }[extension] || 'application/octet-stream'
  );
}

function isWithin(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..');
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] ${signal}`);
  clearTimeout(debounceTimer);
  shutdownController.abort();
  await watcher.close();
  await stopBuild();
  await new Promise((resolve) => server.close(resolve));
  // The rebuild has settled, so nothing can mutate the runtime directories from here on; let a
  // successor start now rather than when the last in-flight response ends.
  releaseLocks();
}

/**
 * Stop the Astro child and wait for the in-flight rebuild to settle. A rebuild that will not
 * settle ends the process instead: releasing the locks while it still runs would let a successor
 * work beside it, whereas the 'exit' handler releases them after this process's last write.
 */
async function stopBuild() {
  const buildProcess = currentBuildProcess;
  if (buildProcess && buildProcess.exitCode === null && buildProcess.signalCode === null) {
    const exited = once(buildProcess, 'exit');
    buildProcess.kill('SIGTERM');
    const stopped = await Promise.race([
      exited.then(() => true),
      sleep(5_000, false, { ref: false }),
    ]);
    if (!stopped) {
      buildProcess.kill('SIGKILL');
      await exited;
    }
  }
  if (activeDrain) {
    const settled = await Promise.race([
      activeDrain.then(() => true),
      sleep(10_000, false, { ref: false }),
    ]);
    if (!settled) {
      console.error('[shutdown] The rebuild did not stop within 10 seconds; exiting.');
      process.exit(1);
    }
  }
}

function releaseSyncLock() {
  const lock = syncLock;
  syncLock = null;
  try {
    lock?.release();
  } catch (error) {
    console.error(`[shutdown] ${formatError(error)}`);
  }
}

function releaseLocks() {
  releaseSyncLock();
  try {
    watcherLock.release();
  } catch (error) {
    console.error(`[shutdown] ${formatError(error)}`);
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function reportBuildStatus(statusPromise) {
  await statusPromise.catch((error) => {
    console.error(`[status] Could not write build status: ${formatError(error)}`);
  });
}
