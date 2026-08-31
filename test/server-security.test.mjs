import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedHostHeader } from '../scripts/server-security.mjs';

test('loopback listeners accept only loopback and .localhost hostnames', () => {
  for (const hostHeader of [
    'localhost:4321',
    'localhost.:4321',
    '127.0.0.1:4321',
    '127.1:4321',
    '[::1]:4321',
    'shelf.localhost',
    'SHELF.LOCALHOST.:443',
  ]) {
    assert.equal(isAllowedHostHeader(hostHeader, '127.0.0.1'), true, hostHeader);
  }

  for (const hostHeader of [
    undefined,
    'example.com',
    'shelf.localhost.example.com',
    'localhost@example.com',
    '[invalid',
  ]) {
    assert.equal(isAllowedHostHeader(hostHeader, '127.0.0.1'), false, String(hostHeader));
  }
});

test('intentional non-loopback listeners accept network hostnames', () => {
  assert.equal(isAllowedHostHeader('docshelf.lan:4321', '0.0.0.0'), true);
  assert.equal(isAllowedHostHeader('192.168.1.20:4321', '192.168.1.20'), true);
});
