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
  const lineGroups = [];
  const lineControls = [];
  const rootStyle = window.getComputedStyle(root);
  const defaultPaddingStart = Number.parseFloat(rootStyle.paddingBlockStart) || 0;
  const defaultPaddingEnd = Number.parseFloat(rootStyle.paddingBlockEnd) || 0;

  const status = createStatus();
  root.append(status);

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

  const defaultLineHeight = lineControls[0]?.button.getBoundingClientRect().height || 16;

  const positionLineControls = () => {
    const leadingLineCount = blocks[0] ? Math.max(0, blocks[0].start - 1) : 0;
    const trailingLineCount = blocks.at(-1)
      ? Math.max(0, sourceLineCount - blocks.at(-1).end)
      : sourceLineCount;
    root.style.paddingBlockStart = `${Math.max(
      defaultPaddingStart,
      leadingLineCount * defaultLineHeight,
    )}px`;
    root.style.paddingBlockEnd = `${Math.max(
      defaultPaddingEnd,
      trailingLineCount * defaultLineHeight,
    )}px`;
    const rootRect = root.getBoundingClientRect();
    const contentInsetStart = Number.parseFloat(rootStyle.paddingInlineStart) || 0;
    const firstControl = lineControls[0]?.button;
    const firstControlRect = firstControl?.getBoundingClientRect();
    const selectionInsetStart = firstControl
      ? Number.parseFloat(window.getComputedStyle(firstControl, '::after').insetInlineStart)
      : Number.NaN;
    const controlInsetStart = firstControlRect
      ? rootStyle.direction === 'rtl'
        ? rootRect.right - firstControlRect.right
        : firstControlRect.left - rootRect.left
      : 0;
    const selectionStart = Number.isFinite(selectionInsetStart)
      ? controlInsetStart + selectionInsetStart
      : contentInsetStart;
    root.style.setProperty(
      '--docshelf-content-width',
      `${Math.max(0, rootRect.width - selectionStart)}px`,
    );
    const rootTop = rootRect.top;
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
          ? rootRect.height
          : position.blockBottom;
      entry.controls.style.insetBlockStart = `${position.top}px`;
      entry.controls.style.blockSize = `${Math.max(1, bottom - position.top)}px`;
      sizeLineControls(entry, position.top, bottom, rootTop);
    }
  };
  let repositionScheduled = false;
  const scheduleLineControlPositioning = () => {
    if (repositionScheduled) return;
    repositionScheduled = true;
    window.requestAnimationFrame(() => {
      repositionScheduled = false;
      positionLineControls();
    });
  };
  const resizeObserver = new ResizeObserver(scheduleLineControlPositioning);
  resizeObserver.observe(root);
  window.addEventListener('resize', scheduleLineControlPositioning);
  void document.fonts?.ready.then(scheduleLineControlPositioning);
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
      if (
        !event.shiftKey &&
        selection?.start === line &&
        selection.end === line
      ) {
        clearSelection('push', true);
        return;
      }
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

  function sizeLineControls(group, groupTop, groupBottom, rootTop) {
    const heights = new Map();

    if (!group.block) {
      distributeLineHeights(heights, group.start, group.end, groupTop, groupBottom);
    } else {
      const blockRect = group.block.element.getBoundingClientRect();
      const blockTop = blockRect.top - rootTop;
      const blockBottom = blockRect.bottom - rootTop;
      const leadingEnd = Math.min(group.end, group.block.start - 1);
      const visibleStart = Math.max(group.start, group.block.start);
      const visibleEnd = Math.min(group.end, group.block.end);
      const trailingStart = Math.max(group.start, group.block.end + 1);

      distributeLineHeights(heights, group.start, leadingEnd, groupTop, blockTop);

      const measuredLines = measureSourceLines(group.block, rootTop);
      if (
        measuredLines &&
        visibleStart === group.block.start &&
        visibleEnd === group.block.end
      ) {
        const boundaries = [blockTop];
        for (let line = visibleStart + 1; line <= visibleEnd; line += 1) {
          const previous = measuredLines.get(line - 1);
          const current = measuredLines.get(line);
          boundaries.push((previous.bottom + current.top) / 2);
        }
        boundaries.push(blockBottom);

        for (let line = visibleStart; line <= visibleEnd; line += 1) {
          const index = line - visibleStart;
          heights.set(line, Math.max(0, boundaries[index + 1] - boundaries[index]));
        }
      } else {
        distributeLineHeights(heights, visibleStart, visibleEnd, blockTop, blockBottom);
      }

      distributeLineHeights(heights, trailingStart, group.end, blockBottom, groupBottom);
    }

    for (let line = group.start; line <= group.end; line += 1) {
      const control = lineControls[line - 1]?.button;
      if (control) control.style.blockSize = `${Math.max(0, heights.get(line) || 0)}px`;
    }
  }

  function distributeLineHeights(heights, start, end, top, bottom) {
    if (end < start) return;
    const height = Math.max(0, bottom - top) / (end - start + 1);
    for (let line = start; line <= end; line += 1) heights.set(line, height);
  }

  function measureSourceLines(block, rootTop) {
    const breakByLine = new Map();
    for (const sourceBreak of block.element.querySelectorAll(
      'br[data-docshelf-line-break-after]',
    )) {
      const line = Number(sourceBreak.dataset.docshelfLineBreakAfter);
      if (Number.isSafeInteger(line) && line >= block.start && line < block.end) {
        breakByLine.set(line, sourceBreak);
      }
    }

    if (breakByLine.size !== block.end - block.start) return null;

    const measurements = new Map();
    let previousBreak = null;

    for (let line = block.start; line <= block.end; line += 1) {
      const range = document.createRange();
      if (previousBreak) range.setStartAfter(previousBreak);
      else range.setStart(block.element, 0);

      const nextBreak = breakByLine.get(line);
      if (nextBreak) range.setEndBefore(nextBreak);
      else range.setEnd(block.element, block.element.childNodes.length);

      const rects = Array.from(range.getClientRects()).filter((rect) => rect.height > 0);
      if (rects.length === 0) return null;

      measurements.set(line, {
        top: Math.min(...rects.map((rect) => rect.top)) - rootTop,
        bottom: Math.max(...rects.map((rect) => rect.bottom)) - rootTop,
      });
      previousBreak = nextBreak || null;
    }

    return measurements;
  }

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

    if (!range) {
      status.textContent = '';
      return;
    }

    status.textContent = firstSelected
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
    if (announce) status.textContent = 'Line selection cleared.';
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
    // Browser-imported Markdown uses a Blob URL whose selection lives in the
    // parent viewer URL. Changing Blob history is unnecessary and is rejected
    // by some browsers even when the Blob inherits the viewer's origin.
    if (url.protocol === 'blob:') return;
    url.hash = hash;
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function createStatus() {
    const status = document.createElement('span');
    status.className = 'docshelf-line-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    return status;
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

  function lineDescription(start, end) {
    return start === end ? `line ${start}` : `lines ${start} through ${end}`;
  }
})();
