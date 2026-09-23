import { htmlSandbox } from '../src/lib/html-sandbox.js';

/** Only trusted build metadata may exempt generated Markdown from HTML isolation. */
export function artifactContentSecurityPolicy(servedPath, markdownRoutes = new Set()) {
  if (!servedPath.startsWith('artifacts/') || !/\.html?$/i.test(servedPath)) return undefined;
  if (markdownRoutes.has(servedPath.slice('artifacts/'.length))) return undefined;
  return `sandbox ${htmlSandbox}`;
}

/** The watcher applies the same policy to its resolved output paths. */
export function htmlIsolationIntegration(shelf, basePath = '/') {
  const markdownRoutes = new Set(shelf.artifacts.filter(artifact => artifact.format === 'markdown').map(artifact => artifact.route));
  const install = server => {
    server.middlewares.use((request, response, next) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
        if (pathname.startsWith(basePath)) {
          const policy = artifactContentSecurityPolicy(pathname.slice(basePath.length), markdownRoutes);
          if (policy) response.setHeader('Content-Security-Policy', policy);
        }
      } catch { /* The server rejects malformed paths. */ }
      next();
    });
  };
  return {
    name: 'docshelf-html-isolation',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => updateConfig({ vite: { plugins: [{ name: 'docshelf-html-isolation', configureServer: install }] } }),
    },
  };
}
