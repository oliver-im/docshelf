import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Create a local annotated release tag, or verify an existing tag without moving it. */
export function ensureReleaseTag(tag, commit, cwd = process.cwd()) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(commit)) {
    throw new Error('The release target must be a full Git commit ID.');
  }
  const git = (...args) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const expected = git('rev-parse', '--verify', `${commit}^{commit}`);
  const ref = `refs/tags/${tag}`;
  let exists = true;
  try {
    git('show-ref', '--verify', '--quiet', ref);
  } catch (error) {
    if (error.status !== 1) throw error;
    exists = false;
  }
  if (exists) {
    // Peel annotated tags; comparing the tag object's ID would reject valid retries.
    const actual = git('rev-parse', '--verify', `${ref}^{commit}`);
    if (actual !== expected) {
      throw new Error(`${tag} points to ${actual}, not release commit ${expected}. Refusing to move it.`);
    }
    return 'verified';
  }
  git('tag', '-a', tag, '-m', tag, expected);
  return 'created';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(`${process.argv[2]}: ${ensureReleaseTag(process.argv[2], process.argv[3])}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
