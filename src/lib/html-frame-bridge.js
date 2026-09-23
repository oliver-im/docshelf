(() => {
  if (window.parent === window) return;
  const parentOrigin = new URL(window.location.href).origin;
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.type !== 'docshelf-theme') return;
    const theme = event.data.theme;
    if (theme !== 'light' && theme !== 'dark') return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.colorScheme = theme;
    window.dispatchEvent(new CustomEvent('docshelf:themechange', { detail: { theme } }));
  });
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[data-docshelf-artifact]') : null;
    if (!link || !['', '_self', '_top'].includes(link.target.toLowerCase())) return;
    const destination = new URL(link.href);
    event.preventDefault();
    window.parent.postMessage({ type: 'docshelf-navigate', route: link.dataset.docshelfArtifact, query: destination.searchParams.get('artifact-query') || '', hash: destination.hash }, parentOrigin);
  });
  window.parent.postMessage({ type: 'docshelf-theme-request' }, parentOrigin);
})();
