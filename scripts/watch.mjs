import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import chokidar from 'chokidar';
import {
  artifactSourcesMatch,
  docShelfRoot,
  defaultManifestPath,
  loadArtifactManifest,
  localManifestPath,
  runtimeRoot,
  syncArtifacts,
} from './artifacts.mjs';
import { browserHost, isAllowedHostHeader } from './server-security.mjs';
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
process.on('exit', releaseLocks);
installShutdownSignals(shutdown, {
  onError: (error) => console.error(`[shutdown] ${formatError(error)}`),
});

let activeBuildRoot = null;
let currentBuildProcess = null;
let activeDrain = null;
let buildRequested = false;
let building = false;
let debounceTimer;
let shuttingDown = false;
let buildSequence = 0;
const pendingReasons = new Set();
const watchedSources = new Set();

const watcher = chokidar.watch([defaultManifestPath, localManifestPath], {
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

activeBuildRoot = await findLatestBuild();
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
  console.log(`[build] ${reasons.join(', ') || 'change detected'}`);

  try {
    // Hold the sync lock for the whole rebuild so `npm run sync`, `build`, `check`, `dev`, and
    // `preview` cannot replace public/artifacts or delete this build's artifact root mid-build.
    syncLock = await acquireSyncLock(runtimeRoot, {
      onWait: (owner) => {
        console.log(`[build] Waiting for ${describeLockOwner(owner)} to finish synchronizing.`);
      },
    });
    const manifest = await loadArtifactManifest();
    const revisionState = await syncArtifacts(manifest, { lock: false });
    await rm(buildRoot, { recursive: true, force: true });

    const exitCode = await runAstroBuild(buildRoot);
    if (exitCode !== 0) {
      if (!(await artifactSourcesMatch(manifest, revisionState))) {
        requestFreshBuild('registered source changed during build');
      }
      throw new Error(`Astro exited with code ${exitCode}.`);
    }

    if (!(await isSuccessfulBuild(buildRoot))) {
      throw new Error('Astro completed without producing index.html.');
    }
    if (!(await artifactSourcesMatch(manifest, revisionState))) {
      requestFreshBuild('registered source changed during build');
      throw new Error('Registered sources changed during the build.');
    }

    const previousBuildRoot = activeBuildRoot;
    await refreshSourceWatches(manifest);
    activeBuildRoot = buildRoot;
    console.log(`[build] Published ${manifest.artifacts.length} artifacts.`);

    if (previousBuildRoot && isWithin(runtimeRoot, previousBuildRoot)) {
      setTimeout(() => {
        void rm(previousBuildRoot, { recursive: true, force: true }).catch((error) => {
          console.error(`[cleanup] ${formatError(error)}`);
        });
      }, 5_000).unref();
    }
  } catch (error) {
    await rm(buildRoot, { recursive: true, force: true });
    console.error(`[build] Failed; continuing to serve the previous build. ${formatError(error)}`);
  } finally {
    releaseSyncLock();
  }
}

function requestFreshBuild(reason) {
  pendingReasons.add(reason);
  buildRequested = true;
}

/** @param {string} buildRoot */
function runAstroBuild(buildRoot) {
  return new Promise((resolve, reject) => {
    currentBuildProcess = spawn(process.execPath, [astroCli, 'build'], {
      cwd: docShelfRoot,
      env: {
        ...process.env,
        DOCSHELF_WATCH_OUT_DIR: buildRoot,
      },
      stdio: 'inherit',
    });

    currentBuildProcess.once('error', reject);
    currentBuildProcess.once('exit', (code, signal) => {
      currentBuildProcess = null;
      if (signal && !shuttingDown) {
        reject(new Error(`Astro was terminated by ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function refreshSourceWatches(existingManifest) {
  const manifest = existingManifest || (await loadArtifactManifest());
  const nextSources = new Set(manifest.artifacts.map((artifact) => artifact.sourcePath));

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

  const buildRoot = activeBuildRoot;
  if (!buildRoot) {
    response.writeHead(503, {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': '1',
    });
    response.end('DocShelf is building\n');
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

  const relativePath = pathname.replace(/^\/+/, '') || 'index.html';
  let filePath = path.resolve(buildRoot, relativePath);

  if (!isWithin(buildRoot, filePath)) {
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
      await sendFile(request, response, notFoundPath, notFoundStats, 404);
    } else {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found\n');
    }
    return;
  }

  await sendFile(request, response, filePath, fileStats, 200);
}

async function sendFile(request, response, filePath, fileStats, statusCode) {
  response.writeHead(statusCode, {
    'cache-control': 'no-cache',
    'content-length': fileStats.size,
    'content-type': contentType(filePath),
    'x-content-type-options': 'nosniff',
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
  await watcher.close();
  await stopBuild();
  await new Promise((resolve) => server.close(resolve));
  // Nothing can mutate the runtime directories from here on, so let a successor start now
  // rather than when the last in-flight response ends.
  releaseLocks();
}

/** Stop the Astro child and wait for the in-flight rebuild to settle. */
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
    await Promise.race([activeDrain, sleep(10_000, undefined, { ref: false })]);
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
