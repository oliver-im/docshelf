(() => {
  const root = document.documentElement;
  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
  let parentRoot;

  try {
    if (window.parent !== window) parentRoot = window.parent.document.documentElement;
  } catch {}

  const applyTheme = () => {
    const parentTheme = parentRoot?.dataset.theme;
    const theme = parentTheme === 'light' || parentTheme === 'dark'
      ? parentTheme
      : colorScheme.matches ? 'dark' : 'light';

    if (root.dataset.colorScheme === theme && root.dataset.theme === theme) return;

    root.dataset.colorScheme = theme;
    root.dataset.theme = theme;
    window.dispatchEvent(new CustomEvent('docshelf:themechange', {
      detail: { theme },
    }));
  };

  applyTheme();
  colorScheme.addEventListener('change', applyTheme);

  if (parentRoot) {
    new MutationObserver(applyTheme).observe(parentRoot, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }
})();
