import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const buildStatusFileName = 'build-status.json';
export const buildStatusRoute = '/__docshelf/status';
const buildStatusVersion = 1;
const maxMessageLength = 1_000;
const maxDetailsLength = 8 * 1_024;

/**
 * Persist the current watcher state. Generations are local to one watcher instance, so clients
 * compare both fields and still recognize a completed rebuild after the watcher restarts.
 */
export class BuildStatusReporter {
  /**
   * @param {string} runtimeRoot
   * @param {{ instanceId?: string, now?: () => Date }} [options]
   */
  constructor(runtimeRoot, options = {}) {
    this.filePath = path.join(runtimeRoot, buildStatusFileName);
    this.instanceId = options.instanceId || randomUUID();
    this.now = options.now || (() => new Date());
    this.generation = 0;
    this.startedAt = null;
    this.reasons = [];
  }

  /** @param {boolean} serving */
  starting(serving) {
    this.startedAt = null;
    this.reasons = [];
    return this.write('starting', { serving, finishedAt: null, error: null });
  }

  /** @param {string[]} reasons @param {boolean} serving */
  building(reasons, serving) {
    this.generation += 1;
    this.startedAt = this.timestamp();
    this.reasons = reasons.filter((reason) => typeof reason === 'string');
    return this.write('building', { serving, finishedAt: null, error: null });
  }

  /** @param {boolean} serving */
  ready(serving) {
    this.assertAttempt();
    return this.write('ready', {
      serving,
      finishedAt: this.timestamp(),
      error: null,
    });
  }

  /** @param {unknown} error @param {boolean} serving */
  failed(error, serving) {
    this.assertAttempt();
    return this.write('failed', {
      serving,
      finishedAt: this.timestamp(),
      error: describeBuildError(error),
    });
  }

  timestamp() {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new Error('The build status clock returned an invalid date.');
    }
    return value.toISOString();
  }

  assertAttempt() {
    if (this.generation === 0 || !this.startedAt) {
      throw new Error('Cannot finish a build status before an attempt starts.');
    }
  }

  /**
   * @param {'starting' | 'building' | 'ready' | 'failed'} state
   * @param {{ serving: boolean, finishedAt: string | null, error: BuildStatusError | null }} values
   */
  write(state, values) {
    return writeBuildStatus(this.filePath, {
      version: buildStatusVersion,
      instanceId: this.instanceId,
      generation: this.generation,
      state,
      updatedAt: this.timestamp(),
      startedAt: this.startedAt,
      finishedAt: values.finishedAt,
      reasons: this.reasons,
      serving: values.serving,
      error: values.error,
    });
  }
}

/**
 * @typedef {object} BuildStatusError
 * @property {string} message
 * @property {string | null} details
 */

/** @param {unknown} error @returns {BuildStatusError} */
export function describeBuildError(error) {
  const message = boundedText(error instanceof Error ? error.message : String(error), maxMessageLength);
  let details = null;

  if (
    typeof error === 'object' &&
    error !== null &&
    'details' in error &&
    typeof error.details === 'string'
  ) {
    details = boundedTail(error.details, maxDetailsLength);
  } else if (error instanceof Error && error.cause) {
    const causes = [];
    let cause = error.cause;
    while (cause && causes.length < 4) {
      causes.push(cause instanceof Error ? cause.message : String(cause));
      cause = cause instanceof Error ? cause.cause : null;
    }
    details = boundedTail(causes.join('\nCaused by: '), maxDetailsLength);
  }

  return { message: message || 'Unknown build failure.', details: details || null };
}

/** @param {string} filePath @param {unknown} status */
async function writeBuildStatus(filePath, status) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
  return status;
}

/** @param {string} value @param {number} limit */
function boundedText(value, limit) {
  const clean = stripAnsi(value).trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`;
}

/** @param {string} value @param {number} limit */
function boundedTail(value, limit) {
  const clean = stripAnsi(value).trim();
  return clean.length <= limit ? clean : `…\n${clean.slice(-(limit - 2))}`;
}

/** @param {string} value */
function stripAnsi(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}
