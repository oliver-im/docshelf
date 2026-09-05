(() => {
  const root = document.querySelector('.markdown-document');
  if (!root || root.dataset.docshelfReading === 'true') return;
  root.dataset.docshelfReading = 'true';
  const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));

  // Keep the native table semantics and confine horizontal scrolling to the table.
  for (const table of root.querySelectorAll('table')) {
    const container = document.createElement('div');
    container.className = 'markdown-table';
    const scroller = document.createElement('div');
    scroller.className = 'markdown-table-scroll';
    scroller.setAttribute('role', 'region');
    const heading = headings.filter((element) =>
      element.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).at(-1);
    scroller.setAttribute('aria-label', heading ? `${heading.textContent} table` : 'Table');
    const hint = document.createElement('p');
    hint.className = 'markdown-table-hint';
    hint.textContent = 'Scroll horizontally to see all columns.';
    hint.setAttribute('data-pagefind-ignore', '');
    hint.hidden = true;
    table.before(container);
    scroller.append(table);
    container.append(hint, scroller);

    const updateOverflow = () => {
      const overflowing = scroller.scrollWidth > scroller.clientWidth + 1;
      scroller.tabIndex = overflowing ? 0 : -1;
      hint.hidden = !overflowing;
    };
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(scroller);
    observer.observe(table);
    updateOverflow();
  }

  const outline = document.querySelector('.markdown-outline details');
  if (!outline) return;
  const wide = window.matchMedia('(min-width: 70rem)');
  const updateLayout = () => { outline.open = wide.matches; };
  wide.addEventListener('change', updateLayout);
  updateLayout();

  const entries = Array.from(outline.querySelectorAll('a')).map((link) => ({
    link,
    heading: document.getElementById(decodeURIComponent(link.hash.slice(1))),
  })).filter((entry) => entry.heading);

  outline.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const entry = entries.find((item) => item.link === link);
    if (!entry) return;
    if (!wide.matches) outline.open = false;
    entry.heading.tabIndex = -1;
    entry.heading.focus({ preventScroll: true });
  });

  let scheduled = false;
  const updateCurrentSection = () => {
    scheduled = false;
    const current = entries.filter((entry) => entry.heading.getBoundingClientRect().top <= 120).at(-1);
    for (const entry of entries) {
      if (entry === current) entry.link.setAttribute('aria-current', 'location');
      else entry.link.removeAttribute('aria-current');
    }
  };
  const scheduleUpdate = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(updateCurrentSection);
  };
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  updateCurrentSection();
})();
