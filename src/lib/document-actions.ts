import { parseClaudeArtifactUrl } from '@docshelf/core/claude-artifacts';
import { parseGitHubMarkdownUrl } from '@docshelf/core/github-markdown';
import './document-actions.css';

interface DocumentArtifact {
  route: string;
  title: string;
  project?: string;
  source?: string;
  embedUrl?: string;
  imported?: boolean;
}

async function responseRecord(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The local server returned an invalid response.');
  return value as Record<string, unknown>;
}

/** One shared menu, attached beside its trigger so mobile navigation retains focus ownership. */
export function createDocumentActions(options: { basePath: string; localActions: boolean; removeImported: (route: string) => void }) {
  const menu = document.createElement('div');
  menu.id = 'docshelf-document-actions';
  menu.className = 'docshelf-document-menu';
  menu.setAttribute('role', 'menu');
  // Right-click opens before pointerup on macOS; automatic light dismissal would immediately close it.
  menu.setAttribute('popover', 'manual');
  const openLink = menuLink('Open in new tab');
  const copyButton = menuButton('Copy link');
  const separator = document.createElement('hr');
  separator.setAttribute('role', 'separator');
  const sourceLink = menuLink('View source');
  const revealButton = menuButton('Reveal in Finder');
  const addButton = menuButton('Add…');
  const removeButton = menuButton('Remove from shelf…');
  menu.append(openLink, copyButton, separator, sourceLink, revealButton, addButton, removeButton);

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

  async function fetchCapabilities() {
    if (!options.localActions || !localHost) return undefined;
    try {
      const response = await fetch(`${options.basePath}__docshelf/local-actions`, {
        cache: 'no-store',
        headers: { 'X-DocShelf-Request': 'document-actions' },
        signal: AbortSignal.timeout(3000),
      });
      return response.ok ? await responseRecord(response) : undefined;
    } catch {
      // Static hosting, preview, and unsupported platforms have no local actions.
      return undefined;
    }
  }

  async function loadCapabilities(selection: NonNullable<typeof active>) {
    if (selection.artifact.imported) return;
    const capability = await fetchCapabilities();
    if (!capability || active !== selection || typeof capability.token !== 'string') return;
    selection.token = capability.token;
    revealButton.hidden = capability.revealInFinder !== true || !!selection.artifact.embedUrl;
    removeButton.hidden = capability.remove !== true;
    separator.hidden = sourceLink.hidden && revealButton.hidden;
    positionMenu();
  }

  function showNotice(message: string, error = false) {
    window.clearTimeout(noticeTimer);
    notice.textContent = message;
    notice.dataset.error = String(error);
    noticeTimer = window.setTimeout(() => { notice.textContent = ''; }, error ? 8000 : 3500);
  }

  menu.addEventListener('beforetoggle', (event) => {
    if (event.newState === 'closed') {
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
  document.addEventListener('pointerdown', (event) => {
    if (active && event.target instanceof Node && !active.trigger.contains(event.target) && !menu.contains(event.target)) close();
  });
  window.addEventListener('resize', () => close());
  document.addEventListener('scroll', () => close(), true);
  window.addEventListener('blur', () => close());
  for (const link of [openLink, sourceLink]) link.addEventListener('click', () => close(true));
  copyButton.addEventListener('click', () => { void copyLink(); });
  async function copyLink() {
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
  }
  addButton.addEventListener('click', () => {
    const project = active?.artifact.project || '';
    close();
    window.dispatchEvent(new CustomEvent('docshelf:add', { detail: { project } }));
  });
  removeButton.addEventListener('click', () => {
    const selection = active;
    if (!selection || !selection.artifact.imported && !selection.token) return;
    close();
    void confirmRemoval(selection.trigger, selection.token, { artifact: selection.artifact });
  });

  async function confirmRemoval(trigger: HTMLElement, token: string | undefined, target: { artifact: DocumentArtifact } | { project: string }) {
    const project = 'project' in target;
    const imported = 'artifact' in target && !!target.artifact.imported;
    const noun = project ? 'project' : 'document';
    const describe = (name: string) => project
      ? `Remove the “${name}” project from DocShelf? Its original files and folders will stay untouched.`
      : `Remove “${name}” from DocShelf? The original file or remote document will stay untouched.`;
    const dialog = document.createElement('dialog');
    dialog.className = 'docshelf-remove-dialog';
    dialog.setAttribute('aria-labelledby', 'docshelf-remove-title');
    dialog.setAttribute('aria-describedby', 'docshelf-remove-description');
    const title = document.createElement('h2');
    title.id = 'docshelf-remove-title';
    title.textContent = 'Remove from shelf?';
    const description = document.createElement('p');
    description.id = 'docshelf-remove-description';
    description.textContent = describe('project' in target ? target.project : target.artifact.title);
    const detail = document.createElement('p');
    detail.textContent = imported ? 'This removes the import from this browser. You can add it again later.' : 'Checking registration…';
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    const actions = document.createElement('div');
    actions.className = 'docshelf-remove-actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.autofocus = true;
    cancel.onclick = () => dialog.close();
    const confirm = document.createElement('button');
    confirm.textContent = 'Remove';
    confirm.disabled = true;
    actions.append(cancel, confirm);
    dialog.append(title, description, detail, error, actions);
    document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); trigger.focus({ preventScroll: true }); });
    dialog.showModal();
    const request = async (action: string, revision?: string) => {
      const response = await fetch(`${options.basePath}__docshelf/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DocShelf-Request': 'document-actions', 'X-DocShelf-Token': token! },
        body: JSON.stringify({ action, ...('project' in target ? { project: target.project } : { route: target.artifact.route }), revision }),
      });
      const result = await responseRecord(response);
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Could not remove the ${noun}.`);
      return result;
    };
    try {
      const prepared = imported ? undefined : await request('remove-preview');
      if (!dialog.open) return;
      const revision = prepared?.revision;
      if (prepared) {
        const { title: name, foldersExcluded, documents, folders } = prepared;
        if (typeof name !== 'string' || typeof revision !== 'string' || typeof foldersExcluded !== 'number') throw new Error('The local server returned an invalid removal preview.');
        description.textContent = describe(name);
        if (project) {
          if (typeof documents !== 'number' || typeof folders !== 'number') throw new Error('The local server returned an invalid removal preview.');
          detail.textContent = projectRemovalDetail(documents, folders, foldersExcluded);
        } else detail.textContent = foldersExcluded ? 'This document will also be excluded from its watched folders so it stays off the shelf.' : 'You can add it again later.';
      }
      confirm.disabled = false;
      confirm.onclick = async () => {
        confirm.disabled = true;
        confirm.textContent = 'Removing…';
        try {
          if ('artifact' in target && target.artifact.imported) options.removeImported(target.artifact.route);
          else if (typeof revision === 'string') await request('remove', revision);
          else throw new Error('Preview the removal again before confirming.');
          dialog.close();
          showNotice(`${project ? 'Project' : 'Document'} removed from shelf. The catalog will update shortly.`);
        } catch (caught) {
          error.textContent = caught instanceof Error ? caught.message : `Could not remove the ${noun}.`;
          confirm.textContent = 'Remove';
        }
      };
    } catch (caught) {
      detail.textContent = '';
      error.textContent = caught instanceof Error ? caught.message : 'Could not read the shelf.';
    }
  }
  revealButton.addEventListener('click', () => { void revealSource(); });
  async function revealSource() {
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
      const result = await responseRecord(response);
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Could not reveal the source file.');
      showNotice('Source file revealed in Finder.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not reveal the source file.', true);
    }
  }

  return {
    /** Resolve the watcher token only when this server can change shelf registrations. */
    async removalToken() {
      const capability = await fetchCapabilities();
      return capability?.remove === true && typeof capability.token === 'string' ? capability.token : undefined;
    },
    removeProject(project: string, trigger: HTMLElement, token: string) {
      void confirmRemoval(trigger, token, { project });
    },
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
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      for (const x of [5, 12, 19]) {
        const dot = document.createElementNS(icon.namespaceURI, 'circle');
        dot.setAttribute('cx', String(x)); dot.setAttribute('cy', '12'); dot.setAttribute('r', '1.6');
        icon.append(dot);
      }
      trigger.append(icon);
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
        removeButton.hidden = !artifact.imported;
        separator.hidden = !remoteSource;
        menu.setAttribute('aria-label', `Actions for ${artifact.title}`);
        menuParent.append(menu);
        menu.showPopover({ source: trigger });
        trigger.setAttribute('aria-expanded', 'true');
        positionMenu();
        (last ? items().at(-1) : items()[0])?.focus({ preventScroll: true });
        void loadCapabilities(active);
      }
      link.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); open(); });
      link.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); event.stopPropagation(); open(); } });
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

function projectRemovalDetail(documents: number, folders: number, foldersExcluded: number) {
  const count = (value: number, noun: string) => value ? [`${value} ${noun}${value === 1 ? '' : 's'}`] : [];
  const removed = [...count(documents, 'document'), ...count(folders, 'watched folder')].join(' and ');
  return `This removes ${removed} from the shelf. ${foldersExcluded ? 'Its documents will also be excluded from other watched folders so they stay off the shelf.' : 'You can add them again later.'}`;
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
