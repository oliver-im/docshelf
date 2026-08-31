import { isIP } from 'node:net';

/**
 * Restrict loopback listeners to hostnames that browsers also resolve to loopback.
 * A deliberate non-loopback DOCSHELF_HOST binding keeps accepting network hostnames.
 *
 * @param {string | undefined} hostHeader
 * @param {string} listenHost
 */
export function isAllowedHostHeader(hostHeader, listenHost) {
  if (!isLoopbackHost(listenHost)) return true;
  if (!hostHeader) return false;

  try {
    const parsedHostname = new URL(`http://${hostHeader}`).hostname;
    const hostname = stripBrackets(parsedHostname).toLowerCase().replace(/\.$/, '');
    return isLoopbackHost(hostname) || hostname === 'localhost' || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** @param {string} hostname */
function isLoopbackHost(hostname) {
  const normalized = stripBrackets(hostname).toLowerCase().replace(/\.$/, '');
  if (normalized === 'localhost' || normalized === '::1') return true;
  return isIP(normalized) === 4 && normalized.startsWith('127.');
}

/** @param {string} hostname */
function stripBrackets(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}
