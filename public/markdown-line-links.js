(() => {
  const root = document.querySelector('.markdown-document');
  if (!root || root.dataset.docshelfLineLinks === 'true') return;

  const lineFragmentPattern = /^#L([1-9]\d*)(?:-L([1-9]\d*))?$/;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const blocks = Array.from(
    root.querySelectorAll('[data-docshelf-line-start][data-docshelf-line-end]'),
  )
    .map((element) => ({
      element,
      start: Number(element.dataset.docshelfLineStart),
      end: Number(element.dataset.docshelfLineEnd),
    }))
    .filter(
      (block) =>
        Number.isSafeInteger(block.start) &&
        Number.isSafeInteger(block.end) &&
        block.start > 0 &&
        block.end >= block.start,
    );

  if (blocks.length === 0) return;

  root.dataset.docshelfLineLinks = 'true';
  let anchor = null;
  let selection = null;
  let copyResetTimer = 0;
  const siblingControls = [];

  const actions = createActions();
  root.append(actions.container);

  for (const block of blocks) {
    const button = document.createElement('button');
    const label = lineLabel(block.start, block.end);
    button.type = 'button';
    button.className = 'docshelf-line-control';
    button.textContent = label;
    button.setAttribute(
      'aria-label',
      `Select source ${lineDescription(block.start, block.end)}. Hold Shift to extend the selection.`,
    );
    button.setAttribute('aria-pressed', 'false');

    button.addEventListener('click', (event) => {
      selectBlock(block, event.shiftKey, event.shiftKey ? 'replace' : 'push');
    });
    button.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && event.shiftKey) {
        event.preventDefault();
        selectBlock(block, true, 'replace');
      }
    });

    const parent = block.element.parentElement;
    const requiresContainedControl =
      !parent || ['OL', 'UL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR'].includes(parent.tagName);
    const controlHost = block.element.tagName === 'TR'
      ? block.element.querySelector('th, td')
      : block.element;
    if (!controlHost) continue;

    block.element.classList.add('docshelf-line-block');
    if (requiresContainedControl) {
      controlHost.classList.add('docshelf-line-control-host');
      if (block.element.tagName === 'TR') {
        controlHost.classList.add('docshelf-line-control-host-table');
      }
      controlHost.prepend(button);
    } else {
      parent.classList.add('docshelf-line-control-container');
      button.classList.add('docshelf-line-control-sibling');
      block.element.before(button);
      siblingControls.push({ block: block.element, button });
    }
    block.element.addEventListener('pointerenter', () => {
      button.classList.add('docshelf-line-control-hovered');
    });
    block.element.addEventListener('pointerleave', () => {
      button.classList.remove('docshelf-line-control-hovered');
    });
    block.button = button;
  }

  const positionSiblingControls = () => {
    for (const entry of siblingControls) {
      entry.button.style.insetBlockStart = `${entry.block.offsetTop - 7}px`;
    }
  };
  const resizeObserver = new ResizeObserver(() => {
    window.requestAnimationFrame(positionSiblingControls);
  });
  resizeObserver.observe(root);
  window.addEventListener('resize', positionSiblingControls);
  void document.fonts?.ready.then(positionSiblingControls);
  positionSiblingControls();

  actions.copy.addEventListener('click', () => void copyLineLink());
  actions.clear.addEventListener('click', () => clearSelection('push', true));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selection) clearSelection('push', true);
  });
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    if (event.data?.type !== 'docshelf-apply-line-selection') return;

    applyHash(event.data.hash, event.data.scroll !== false);
  });
  window.addEventListener('hashchange', () => {
    applyHash(window.location.hash, true);
  });

  applyHash(window.location.hash, true);

  function selectBlock(block, extend, historyMode) {
    let start = block.start;
    let end = block.end;

    if (extend && anchor) {
      start = Math.min(anchor.start, block.start);
      end = Math.max(anchor.end, block.end);
    } else {
      anchor = { start: block.start, end: block.end };
    }

    setSelection({ start, end }, false);
    const hash = lineFragment(start, end);
    replaceFrameHash(hash);
    notifyParent(hash, historyMode);
  }

  function applyHash(hash, scroll) {
    const range = parseLineFragment(hash);

    if (!range) {
      setSelection(null, false);
      anchor = null;
      return;
    }

    anchor = { ...range };
    setSelection(range, scroll);
    replaceFrameHash(lineFragment(range.start, range.end));
  }

  function setSelection(range, scroll) {
    selection = range;
    let firstSelected = null;

    for (const block of blocks) {
      const selected = Boolean(
        range && block.end >= range.start && block.start <= range.end,
      );
      block.element.toggleAttribute('data-docshelf-line-selected', selected);
      block.button?.setAttribute('aria-pressed', String(selected));
      if (selected && !firstSelected) firstSelected = block.element;
    }

    actions.container.hidden = !range;
    if (!range) {
      actions.status.textContent = '';
      return;
    }

    actions.range.textContent = lineLabel(range.start, range.end);
    actions.status.textContent = firstSelected
      ? `Selected source ${lineDescription(range.start, range.end)}.`
      : `Source ${lineDescription(range.start, range.end)} is not visible in the rendered document.`;

    if (scroll && firstSelected) {
      firstSelected.scrollIntoView({
        block: 'center',
        behavior: reducedMotion.matches ? 'auto' : 'smooth',
      });
    }
  }

  function clearSelection(historyMode, announce) {
    if (!selection) return;
    selection = null;
    anchor = null;
    setSelection(null, false);
    replaceFrameHash('');
    notifyParent('', historyMode);
    if (announce) actions.status.textContent = 'Line selection cleared.';
  }

  function notifyParent(hash, historyMode) {
    if (window.parent === window) {
      const url = new URL(window.location.href);
      url.searchParams.delete('__docshelf_revision');
      url.searchParams.delete('rev');
      url.hash = hash;
      window.history[historyMode === 'replace' ? 'replaceState' : 'pushState'](
        null,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
      return;
    }

    window.parent.postMessage(
      {
        type: 'docshelf-line-selection',
        hash,
        historyMode,
      },
      window.location.origin,
    );
  }

  function replaceFrameHash(hash) {
    if (window.parent === window) return;
    const url = new URL(window.location.href);
    url.hash = hash;
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  async function copyLineLink() {
    if (!selection) return;

    const hash = lineFragment(selection.start, selection.end);
    const url = lineLinkUrl(hash);
    let copied = false;

    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      const fallback = document.createElement('textarea');
      fallback.value = url;
      fallback.setAttribute('readonly', '');
      fallback.className = 'docshelf-copy-fallback';
      document.body.append(fallback);
      fallback.select();
      const legacyCopy = Reflect.get(document, 'execCommand');
      copied = typeof legacyCopy === 'function' && legacyCopy.call(document, 'copy');
      fallback.remove();
    }

    window.clearTimeout(copyResetTimer);
    actions.copy.textContent = copied ? 'Copied' : 'Copy failed';
    actions.status.textContent = copied ? 'Line link copied.' : 'Could not copy the line link.';
    copyResetTimer = window.setTimeout(() => {
      actions.copy.textContent = 'Copy link';
    }, 2_000);
  }

  function lineLinkUrl(hash) {
    let url;
    try {
      url = new URL(window.parent === window ? window.location.href : window.parent.location.href);
    } catch {
      url = new URL(window.location.href);
    }

    url.searchParams.delete('__docshelf_revision');
    url.searchParams.delete('rev');
    url.hash = hash;
    return url.href;
  }

  function createActions() {
    const container = document.createElement('aside');
    const range = document.createElement('strong');
    const copy = document.createElement('button');
    const clear = document.createElement('button');
    const status = document.createElement('span');

    container.className = 'docshelf-line-actions';
    container.hidden = true;
    container.setAttribute('aria-label', 'Source line selection');
    range.className = 'docshelf-line-actions-range';
    copy.type = 'button';
    copy.className = 'docshelf-line-action';
    copy.textContent = 'Copy link';
    clear.type = 'button';
    clear.className = 'docshelf-line-action';
    clear.textContent = 'Clear';
    status.className = 'docshelf-line-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    container.append(range, copy, clear, status);

    return { container, range, copy, clear, status };
  }

  function parseLineFragment(hash) {
    const match = lineFragmentPattern.exec(typeof hash === 'string' ? hash : '');
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    return Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start
      ? { start, end }
      : null;
  }

  function lineFragment(start, end) {
    return start === end ? `#L${start}` : `#L${start}-L${end}`;
  }

  function lineLabel(start, end) {
    return start === end ? `L${start}` : `L${start}\u2013L${end}`;
  }

  function lineDescription(start, end) {
    return start === end ? `line ${start}` : `lines ${start} through ${end}`;
  }
})();
