(() => {
  /** @typedef {{ diagram: HTMLDivElement, failureReported: boolean, fallback: HTMLElement, notice: HTMLParagraphElement | null, source: string }} MermaidBlock */
  const blocks = Array.from(
    document.querySelectorAll('pre > code.language-mermaid'),
    /** @returns {MermaidBlock | null} */
    (code) => {
      const fallback = code.parentElement;
      if (!fallback) return null;

      const diagram = document.createElement('div');
      diagram.className = 'mermaid-diagram';
      diagram.hidden = true;
      fallback.after(diagram);

      return {
        diagram,
        failureReported: false,
        fallback,
        notice: null,
        source: code.textContent || '',
      };
    },
  ).filter((block) => block !== null);

  const loadedMermaid = window.mermaid;
  if (blocks.length === 0 || typeof loadedMermaid?.initialize !== 'function') return;
  const mermaid = loadedMermaid;

  let renderPending = false;
  let rendering = false;
  let renderSequence = 0;

  window.addEventListener('docshelf:themechange', requestRender);
  requestRender();

  function requestRender() {
    renderPending = true;
    if (!rendering) void renderDiagrams();
  }

  async function renderDiagrams() {
    rendering = true;

    try {
      while (renderPending) {
        renderPending = false;
        const sequence = ++renderSequence;
        const theme = document.documentElement.dataset.theme === 'light' ? 'default' : 'dark';

        mermaid.initialize({
          securityLevel: 'strict',
          startOnLoad: false,
          suppressErrorRendering: true,
          theme,
        });

        for (const [index, block] of blocks.entries()) {
          if (renderPending) break;
          await renderBlock(block, index, sequence);
        }
      }
    } catch (error) {
      for (const block of blocks) {
        block.diagram.replaceChildren();
        block.diagram.hidden = true;
        block.fallback.hidden = false;
        showFailureNotice(block);
      }
      console.warn('Could not initialize Mermaid diagrams.', error);
    } finally {
      rendering = false;
      if (renderPending) void renderDiagrams();
    }
  }

  /** @param {MermaidBlock} block @param {number} index @param {number} sequence */
  async function renderBlock(block, index, sequence) {
    try {
      const { svg, bindFunctions } = await mermaid.render(
        `docshelf-mermaid-${sequence}-${index}`,
        block.source,
      );
      if (renderPending) return;

      // Treat renderer output as untrusted markup, including HTML labels inside SVG.
      const purifier = window.DOMPurify;
      if (!purifier) throw new Error('The diagram sanitizer is unavailable.');
      const fragment = purifier.sanitize(svg, {
        RETURN_DOM_FRAGMENT: true,
        // Mermaid uses foreignObject for HTML labels; its children still pass through sanitization.
        ADD_TAGS: ['foreignObject'],
        HTML_INTEGRATION_POINTS: { foreignobject: true },
        FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
      });
      block.diagram.replaceChildren(fragment);
      bindFunctions?.(block.diagram);
      block.diagram.hidden = false;
      block.fallback.hidden = true;
      if (block.notice) block.notice.hidden = true;
    } catch (error) {
      if (renderPending) return;

      block.diagram.replaceChildren();
      block.diagram.hidden = true;
      block.fallback.hidden = false;
      showFailureNotice(block);
      if (!block.failureReported) {
        block.failureReported = true;
        console.warn('Could not render Mermaid diagram.', error);
      }
    }
  }

  /** @param {MermaidBlock} block */
  function showFailureNotice(block) {
    if (!block.notice) {
      block.notice = document.createElement('p');
      block.notice.className = 'mermaid-render-error';
      block.notice.setAttribute('role', 'status');
      block.notice.textContent = 'Could not render this Mermaid diagram. Showing its source.';
      block.diagram.after(block.notice);
    }
    block.notice.hidden = false;
  }
})();
