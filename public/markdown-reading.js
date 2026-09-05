(() => {
  const root = document.querySelector('.markdown-document');
  if (!root || root.dataset.docshelfReading === 'true') return;
  root.dataset.docshelfReading = 'true';
  // Structure is rendered on the server, before source-line controls are measured.
  for (const container of root.querySelectorAll('.markdown-table')) {
    const table = container.querySelector('table');
    const scroller = container.querySelector('.markdown-table-scroll');
    const hint = container.querySelector('.markdown-table-hint');

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
  let clickedEntry = entries.find((entry) => entry.link.hash === window.location.hash) || null;

  outline.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const entry = entries.find((item) => item.link === link);
    if (!entry) return;
    if (!wide.matches) outline.open = false;
    entry.heading.tabIndex = -1;
    entry.heading.focus({ preventScroll: true });
    clickedEntry = entry;
    setCurrentSection(entry);
  });

  let scheduled = false;
  const setCurrentSection = (current) => {
    for (const entry of entries) {
      if (entry === current) entry.link.setAttribute('aria-current', 'location');
      else entry.link.removeAttribute('aria-current');
    }
  };
  const updateCurrentSection = () => {
    scheduled = false;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const atEnd = maxScroll > 0 && window.scrollY >= maxScroll - 2;
    const current = clickedEntry || (atEnd ? entries.at(-1)
      : entries.filter((entry) => entry.heading.getBoundingClientRect().top <= 120).at(-1));
    setCurrentSection(current);
  };
  const scheduleUpdate = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(updateCurrentSection);
  };
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  // Keep an explicit destination highlighted during smooth scrolling, until the
  // reader takes over. A clamped final section may never reach the top threshold.
  const resumeScrollTracking = () => { clickedEntry = null; scheduleUpdate(); };
  window.addEventListener('wheel', resumeScrollTracking, { passive: true });
  window.addEventListener('touchstart', resumeScrollTracking, { passive: true });
  window.addEventListener('pointerdown', resumeScrollTracking, { passive: true });
  window.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
      resumeScrollTracking();
    }
  });
  const followFragment = () => {
    clickedEntry = entries.find((entry) => entry.link.hash === window.location.hash) || null;
    scheduleUpdate();
  };
  window.addEventListener('hashchange', followFragment);
  window.addEventListener('docshelf:fragmentchange', followFragment);
  updateCurrentSection();
})();
