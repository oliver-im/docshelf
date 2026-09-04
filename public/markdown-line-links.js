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
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const configuredLineCount = Number(root.dataset.docshelfSourceLineCount);
  const highestRenderedLine = blocks.reduce((highest, block) => Math.max(highest, block.end), 0);
  const sourceLineCount =
    Number.isSafeInteger(configuredLineCount) && configuredLineCount >= highestRenderedLine
      ? configuredLineCount
      : highestRenderedLine;

  if (sourceLineCount === 0) return;

  root.dataset.docshelfLineLinks = 'true';
  let anchor = null;
  let selection = null;
  let copyResetTimer = 0;
  const lineGroups = [];
  const lineControls = [];
  const rootStyle = window.getComputedStyle(root);
  const defaultPaddingStart = Number.parseFloat(rootStyle.paddingBlockStart) || 0;
  const defaultPaddingEnd = Number.parseFloat(rootStyle.paddingBlockEnd) || 0;

  const actions = createActions();
  root.append(actions.container);

  let nextUnassignedLine = 1;
  for (const [index, block] of blocks.entries()) {
    block.element.classList.add('docshelf-line-block');
    const nextBlock = blocks[index + 1];
    const controlStart = nextUnassignedLine;
    const controlEnd = nextBlock
      ? Math.min(sourceLineCount, Math.max(block.end, nextBlock.start - 1))
      : sourceLineCount;
    if (controlEnd < controlStart) continue;

    const controls = document.createElement('div');
    controls.className = 'docshelf-line-controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', `Source ${lineDescription(controlStart, controlEnd)}`);

    for (let line = controlStart; line <= controlEnd; line += 1) {
      controls.append(createLineControl(line));
    }

    root.append(controls);
    lineGroups.push({ block, controls, start: controlStart, end: controlEnd });
    nextUnassignedLine = controlEnd + 1;
  }

  if (blocks.length === 0) {
    const controls = document.createElement('div');
    controls.className = 'docshelf-line-controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', `Source ${lineDescription(1, sourceLineCount)}`);
    for (let line = 1; line <= sourceLineCount; line += 1) {
      controls.append(createLineControl(line));
    }
    root.append(controls);
    lineGroups.push({ block: null, controls, start: 1, end: sourceLineCount });
  }

  const positionLineControls = () => {
    const lineHeight = lineControls[0]?.button.getBoundingClientRect().height || 0;
    const leadingLineCount = blocks[0] ? Math.max(0, blocks[0].start - 1) : 0;
    const trailingLineCount = blocks.at(-1)
      ? Math.max(0, sourceLineCount - blocks.at(-1).end)
      : sourceLineCount;
    root.style.paddingBlockStart = `${Math.max(defaultPaddingStart, leadingLineCount * lineHeight)}px`;
    root.style.paddingBlockEnd = `${Math.max(defaultPaddingEnd, trailingLineCount * lineHeight)}px`;
    root.style.setProperty('--docshelf-content-width', `${root.getBoundingClientRect().width}px`);

    const rootTop = root.getBoundingClientRect().top;
    const positions = lineGroups.map((entry) => {
      const blockTop = entry.block
        ? entry.block.element.getBoundingClientRect().top - rootTop
        : defaultPaddingStart;
      const blockBottom = entry.block
        ? entry.block.element.getBoundingClientRect().bottom - rootTop
        : root.getBoundingClientRect().height;
      const hasLeadingLines = Boolean(entry.block && entry.start < entry.block.start);
      return { blockTop, blockBottom, top: hasLeadingLines ? 0 : blockTop };
    });

    for (const [index, entry] of lineGroups.entries()) {
      const position = positions[index];
      const nextPosition = positions[index + 1];
      const hasTrailingLines = Boolean(entry.block && entry.end > entry.block.end);
      const bottom = nextPosition
        ? nextPosition.top
        : hasTrailingLines || !entry.block
          ? root.getBoundingClientRect().height
          : position.blockBottom;
      entry.controls.style.insetBlockStart = `${position.top}px`;
      entry.controls.style.blockSize = `${Math.max(1, bottom - position.top)}px`;
    }
  };
  const resizeObserver = new ResizeObserver(() => {
    window.requestAnimationFrame(positionLineControls);
  });
  resizeObserver.observe(root);
  window.addEventListener('resize', positionLineControls);
  void document.fonts?.ready.then(positionLineControls);
  positionLineControls();

  function createLineControl(line) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'docshelf-line-control';
    button.dataset.docshelfSourceLine = String(line);
    button.textContent = String(line);
    button.tabIndex = lineControls.length === 0 ? 0 : -1;
    button.setAttribute(
      'aria-label',
      `Select source line ${line}. Hold Shift to extend the selection.`,
    );
    button.setAttribute('aria-pressed', 'false');

    const entry = { line, button };
    lineControls.push(entry);

    button.addEventListener('click', (event) => {
      setRovingControl(entry, false);
      selectLine(line, event.shiftKey, event.shiftKey ? 'replace' : 'push');
    });
    button.addEventListener('keydown', (event) => {
      const currentIndex = lineControls.indexOf(entry);
      const destination =
        event.key === 'ArrowUp'
          ? lineControls[currentIndex - 1]
          : event.key === 'ArrowDown'
            ? lineControls[currentIndex + 1]
            : event.key === 'Home'
              ? lineControls[0]
              : event.key === 'End'
                ? lineControls.at(-1)
                : null;
      if (destination) {
        event.preventDefault();
        setRovingControl(destination, true);
        return;
      }
      if ((event.key === 'Enter' || event.key === ' ') && event.shiftKey) {
        event.preventDefault();
        selectLine(line, true, 'replace');
      }
    });

    return button;
  }

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

  function selectLine(line, extend, historyMode) {
    let start = line;
    let end = line;

    if (extend && anchor !== null) {
      start = Math.min(anchor, line);
      end = Math.max(anchor, line);
    } else {
      anchor = line;
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

    anchor = range.start;
    setSelection(range, scroll);
    replaceFrameHash(lineFragment(range.start, range.end));
  }

  function setSelection(range, scroll) {
    selection = range;
    let firstSelected = null;
    let firstSelectedControl = null;

    for (const block of blocks) {
      const intersectsSelection = Boolean(
        range && block.end >= range.start && block.start <= range.end,
      );
      const fullySelected = Boolean(
        range && range.start <= block.start && range.end >= block.end,
      );
      block.element.toggleAttribute('data-docshelf-line-selected', fullySelected);
      if (intersectsSelection && !firstSelected) firstSelected = block.element;
    }

    for (const entry of lineControls) {
      const lineSelected = Boolean(
        range && entry.line >= range.start && entry.line <= range.end,
      );
      entry.button.setAttribute('aria-pressed', String(lineSelected));
      if (lineSelected && !firstSelectedControl) firstSelectedControl = entry;
    }

    if (firstSelectedControl) setRovingControl(firstSelectedControl, false);

    actions.container.hidden = !range;
    if (!range) {
      actions.status.textContent = '';
      return;
    }

    actions.range.textContent = lineLabel(range.start, range.end);
    actions.status.textContent = firstSelected
      ? `Selected source ${lineDescription(range.start, range.end)}.`
      : `Source ${lineDescription(range.start, range.end)} is not visible in the rendered document.`;

    const scrollTarget = firstSelected || firstSelectedControl?.button;
    if (scroll && scrollTarget) {
      scrollTarget.scrollIntoView({
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

  function setRovingControl(active, focus) {
    for (const entry of lineControls) {
      entry.button.tabIndex = entry === active ? 0 : -1;
    }
    if (focus) active.button.focus();
  }

  function notifyParent(hash, historyMode) {
    if (window.parent === window) {
      const url = new URL(window.location.href);
      url.searchParams.delete('__docshelf_revision');
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
