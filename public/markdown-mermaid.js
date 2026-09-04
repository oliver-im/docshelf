(() => {
  const blocks = Array.from(
    document.querySelectorAll('pre > code.language-mermaid'),
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
  ).filter(Boolean);

  const mermaid = globalThis.mermaid;
  if (blocks.length === 0 || typeof mermaid?.initialize !== 'function') return;

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

  async function renderBlock(block, index, sequence) {
    try {
      const { svg, bindFunctions } = await mermaid.render(
        `docshelf-mermaid-${sequence}-${index}`,
        block.source,
      );
      if (renderPending) return;

      block.diagram.innerHTML = svg;
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
