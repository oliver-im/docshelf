/**
 * Normalize the path beneath which DocShelf is served.
 *
 * @param {unknown} value
 */
export function normalizeBasePath(value) {
  if (value === undefined || value === null || value === '' || value === '/') return '/';
  if (typeof value !== 'string') throw new Error('DOCSHELF_BASE must be a path.');

  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '/';

  const candidate = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const segments = candidate.replace(/^\/+|\/+$/g, '').split('/');
  if (
    candidate.includes('?') ||
    candidate.includes('#') ||
    candidate.includes('//') ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        !/^[a-z\d._~-]+$/i.test(segment),
    )
  ) {
    throw new Error(`Invalid DocShelf base path: ${value}`);
  }

  return `/${segments.join('/')}/`;
}

/**
 * Prefix a root-relative application path with DocShelf's mount path.
 *
 * @param {string} pathname
 * @param {unknown} basePath
 */
export function sitePath(pathname, basePath = '/') {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) {
    throw new Error(`DocShelf site paths must be root-relative: ${pathname}`);
  }

  const base = normalizeBasePath(basePath);
  return base === '/' ? pathname : `${base.slice(0, -1)}${pathname}`;
}
