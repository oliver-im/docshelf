import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { ensureReleaseTag } from '../scripts/release-tag.mjs';
import { temporaryDirectory } from './helpers/temporary-directory.mjs';

async function repository(t) {
  const cwd = await temporaryDirectory(t, tmpdir(), 'docshelf-release-');
  const git = (...args) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('commit', '--allow-empty', '-qm', 'First commit');
  const first = git('rev-parse', 'HEAD');
  git('commit', '--allow-empty', '-qm', 'Second commit');
  return { cwd, git, first, second: git('rev-parse', 'HEAD') };
}

test('release tags use the explicit commit even when HEAD has advanced', async (t) => {
  const { cwd, git, first, second } = await repository(t);
  assert.equal(ensureReleaseTag('v0.1.0', first, cwd), 'created');
  assert.equal(git('cat-file', '-t', 'refs/tags/v0.1.0'), 'tag');
  assert.equal(git('rev-parse', 'refs/tags/v0.1.0^{commit}'), first);
  assert.equal(git('rev-parse', 'HEAD'), second);
});

test('retries preserve matching annotated and lightweight tags', async (t) => {
  const { cwd, git, second } = await repository(t);
  git('tag', '-a', 'v0.1.0', '-m', 'Original release notes', second);
  git('tag', 'v0.1.1', second);
  const annotation = git('rev-parse', 'refs/tags/v0.1.0');
  for (const tag of ['v0.1.0', 'v0.1.1']) {
    assert.equal(ensureReleaseTag(tag, second, cwd), 'verified');
  }
  assert.equal(git('rev-parse', 'refs/tags/v0.1.0'), annotation);
  assert.equal(git('cat-file', '-t', 'refs/tags/v0.1.1'), 'commit');
});

test('mismatched release tags fail without moving either tag', async (t) => {
  const { cwd, git, first, second } = await repository(t);
  git('tag', '-a', 'v0.1.0', '-m', 'Already published', first);
  git('tag', 'v0.1.1', first);
  for (const tag of ['v0.1.0', 'v0.1.1']) {
    const before = git('rev-parse', `refs/tags/${tag}`);
    assert.throws(() => ensureReleaseTag(tag, second, cwd), /Refusing to move it/);
    assert.equal(git('rev-parse', `refs/tags/${tag}`), before);
  }
});

test('a branch with the release name cannot stand in for a tag', async (t) => {
  const { cwd, git, first, second } = await repository(t);
  git('branch', 'v0.1.0', first);
  assert.equal(ensureReleaseTag('v0.1.0', second, cwd), 'created');
  assert.equal(git('rev-parse', 'refs/tags/v0.1.0^{commit}'), second);
  assert.equal(git('rev-parse', 'refs/heads/v0.1.0'), first);
});

test('invalid versions and unresolved targets create no tags', async (t) => {
  const { cwd, git, second } = await repository(t);
  for (const tag of ['v01.0.0', 'v1.0', 'v1.0.0-beta', '--delete', '01.0.0', '1.0.0-beta']) {
    assert.throws(() => ensureReleaseTag(tag, second, cwd), /Invalid release tag/);
  }
  assert.throws(() => ensureReleaseTag('v0.1.0', 'HEAD', cwd), /full Git commit ID/);
  assert.throws(() => ensureReleaseTag('v0.1.0', '0'.repeat(40), cwd));
  assert.equal(git('tag', '--list'), '');
});

test('Obsidian tags match plain manifest versions and never move on a retry', async t => {
  const { cwd, git, first, second } = await repository(t);
  assert.equal(ensureReleaseTag('0.1.0', first, cwd), 'created');
  assert.equal(ensureReleaseTag('0.1.0', first, cwd), 'verified');
  assert.throws(() => ensureReleaseTag('0.1.0', second, cwd), /Refusing to move it/);
  assert.equal(git('rev-parse', 'refs/tags/0.1.0^{commit}'), first);
});
