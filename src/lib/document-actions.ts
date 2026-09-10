import { parseClaudeArtifactUrl } from './claude-artifacts.js';
import { parseGitHubMarkdownUrl } from './github-markdown.js';
import './document-actions.css';

interface DocumentArtifact {
  route: string;
  title: string;
  source?: string;
  embedUrl?: string;
  imported?: boolean;
}

/** One shared menu, attached beside its trigger so mobile navigation retains focus ownership. */
export function createDocumentActions(options: { basePath: string; localActions: boolean }) {
  const menu = document.createElement('div');
  menu.id = 'docshelf-document-actions';
  menu.className = 'docshelf-document-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('popover', 'auto');
  const openLink = menuLink('Open in new tab');
  const copyButton = menuButton('Copy link');
  const separator = document.createElement('hr');
  separator.setAttribute('role', 'separator');
  const sourceLink = menuLink('View source');
  const revealButton = menuButton('Reveal in Finder');
  menu.append(openLink, copyButton, separator, sourceLink, revealButton);

  const notice = document.createElement('div');
  notice.className = 'docshelf-action-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  document.body.append(notice);
  let noticeTimer: number;
  let escapeReleaseTarget: HTMLButtonElement | undefined;
  let active: {
    trigger: HTMLButtonElement;
    artifact: DocumentArtifact;
    viewerUrl: () => string;
    token?: string;
  } | undefined;
  const localHost = /^(localhost|[\w.-]+\.localhost|127(?:\.\d+){3}|\[::1\])$/i.test(location.hostname);

  function items() {
    return Array.from(menu.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>('[role="menuitem"]'))
      .filter((item) => !item.hidden);
  }

  function close(restoreFocus = false) {
    const trigger = active?.trigger;
    if ('showPopover' in menu && menu.matches(':popover-open')) menu.hidePopover();
    trigger?.setAttribute('aria-expanded', 'false');
    active = undefined;
    if (restoreFocus) trigger?.focus({ preventScroll: true });
  }

  function positionMenu() {
    if (!active) return;
    const rect = active.trigger.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const top = rect.bottom + height + 4 <= window.innerHeight - 8
      ? rect.bottom + 4 : Math.max(8, rect.top - height - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  async function loadFinderCapability(selection: NonNullable<typeof active>) {
    if (!options.localActions || !localHost || selection.artifact.imported || selection.artifact.embedUrl) return;
    try {
      const response = await fetch(`${options.basePath}__docshelf/local-actions`, {
        cache: 'no-store',
        headers: { 'X-DocShelf-Request': 'document-actions' },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return;
      const capability = await response.json();
      if (active !== selection || capability.revealInFinder !== true || typeof capability.token !== 'string') return;
      selection.token = capability.token;
      revealButton.hidden = false;
      separator.hidden = false;
      positionMenu();
    } catch {
      // Static hosting, preview, and unsupported platforms have no Finder action.
    }
  }

  function showNotice(message: string, error = false) {
    clearTimeout(noticeTimer);
    notice.textContent = message;
    notice.dataset.error = String(error);
    noticeTimer = window.setTimeout(() => { notice.textContent = ''; }, error ? 8000 : 3500);
  }

  menu.addEventListener('beforetoggle', (event) => {
    if ((event as ToggleEvent).newState === 'closed') {
      active?.trigger.setAttribute('aria-expanded', 'false');
      active = undefined;
    }
  });
  menu.addEventListener('keydown', (event) => {
    const entries = items();
    const current = entries.indexOf(document.activeElement as HTMLButtonElement);
    let index: number | undefined;
    if (event.key === 'ArrowDown') index = (current + 1) % entries.length;
    if (event.key === 'ArrowUp') index = (current - 1 + entries.length) % entries.length;
    if (event.key === 'Home') index = 0;
    if (event.key === 'End') index = entries.length - 1;
    if (index !== undefined) {
      event.preventDefault();
      entries[index]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      escapeReleaseTarget = active?.trigger;
      close(true);
    } else if (event.key === 'Tab') {
      // Resume normal sidebar tab order from the menu button.
      close(true);
    } else if (event.key === ' ' && document.activeElement instanceof HTMLAnchorElement) {
      event.preventDefault();
      document.activeElement.click();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const ordered = [...entries.slice(current + 1), ...entries.slice(0, current + 1)];
      ordered.find((item) => item.textContent?.toLowerCase().startsWith(event.key.toLowerCase()))?.focus();
    }
  });
  document.addEventListener('keyup', (event) => {
    if (event.key !== 'Escape') return;
    // Starlight closes mobile navigation on keyup, after focus has returned to our button.
    if (event.target === escapeReleaseTarget) event.stopPropagation();
    escapeReleaseTarget = undefined;
  }, true);
  document.addEventListener('focusin', (event) => {
    if (active && event.target instanceof Node && event.target !== active.trigger && !menu.contains(event.target)) close();
  });
  window.addEventListener('resize', () => close());
  document.addEventListener('scroll', () => close(), true);
  window.addEventListener('blur', () => close());
  for (const link of [openLink, sourceLink]) link.addEventListener('click', () => close(true));
  copyButton.addEventListener('click', async () => {
    const selection = active;
    if (!selection) return;
    const url = new URL(selection.viewerUrl(), window.location.href).href;
    close(true);
    try {
      await navigator.clipboard.writeText(url);
      showNotice('Document link copied.');
    } catch {
      showNotice('Could not copy the link. Check your browser’s clipboard permission.', true);
    }
  });
  revealButton.addEventListener('click', async () => {
    const selection = active;
    if (!selection?.token) return;
    close(true);
    try {
      const response = await fetch(`${options.basePath}__docshelf/reveal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-DocShelf-Request': 'document-actions',
          'X-DocShelf-Token': selection.token,
        },
        body: JSON.stringify({ route: selection.artifact.route }),
        signal: AbortSignal.timeout(10000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not reveal the source file.');
      showNotice('Source file revealed in Finder.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not reveal the source file.', true);
    }
  });

  return {
    add(link: HTMLAnchorElement, getArtifact: () => DocumentArtifact | undefined, viewerUrl: () => string) {
      const row = link.parentElement;
      if (!row || !('showPopover' in menu)) return;
      const menuParent: HTMLElement = row;
      row.classList.add('docshelf-document-row');
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'docshelf-document-more';
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-controls', menu.id);
      trigger.popoverTargetElement = menu;
      trigger.setAttribute('aria-label', `Actions for ${link.textContent?.trim() || 'document'}`);
      trigger.title = 'Document actions';
      trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
      row.append(trigger);

      function open(last = false) {
        if (active?.trigger === trigger) { close(true); return; }
        close();
        const artifact = getArtifact();
        if (!artifact) return;
        active = { trigger, artifact, viewerUrl };
        const remoteSource = parseClaudeArtifactUrl(artifact.embedUrl || artifact.source || '')?.publicUrl
          || parseGitHubMarkdownUrl(artifact.source || '')?.sourceUrl;
        openLink.href = link.href;
        sourceLink.hidden = !remoteSource;
        sourceLink.href = remoteSource || '';
        revealButton.hidden = true;
        separator.hidden = !remoteSource;
        menu.setAttribute('aria-label', `Actions for ${artifact.title}`);
        menuParent.append(menu);
        menu.showPopover({ source: trigger });
        trigger.setAttribute('aria-expanded', 'true');
        positionMenu();
        (last ? items().at(-1) : items()[0])?.focus({ preventScroll: true });
        void loadFinderCapability(active);
      }
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        open();
      });
      trigger.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          open(event.key === 'ArrowUp');
        }
      });
    },
  };
}

function menuLink(label: string) {
  const link = document.createElement('a');
  link.textContent = label;
  link.setAttribute('role', 'menuitem');
  link.tabIndex = -1;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function menuButton(label: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('role', 'menuitem');
  button.tabIndex = -1;
  return button;
}
