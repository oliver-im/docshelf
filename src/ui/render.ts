import DOMPurify from 'dompurify';
import path from 'node:path';
import { renderMarkdown } from '../core/markdown';
import type { Artifact } from '../core/types';
import type { DocumentServer } from '../core/server';
import { LineSelection } from './lines';

export function renderReading(parent: HTMLElement, source: string, artifact: Artifact, server: DocumentServer, selection: LineSelection, navigate: (href: string) => void): void {
  const { html, lineCount } = renderMarkdown(source);
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'], FORBID_ATTR: ['style', 'srcset'], USE_PROFILES: { html: true } });
  for (const image of fragment.querySelectorAll('img')) {
    const source = image.getAttribute('src') || '';
    const safe = imageUrl(source, artifact, server);
    if (safe) { image.src = safe; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; }
    else { image.removeAttribute('src'); image.title = 'Register this image in the document’s assets list to display it.'; }
  }
  for (const anchor of fragment.querySelectorAll('a')) {
    const href = anchor.getAttribute('href') || '';
    anchor.removeAttribute('target');
    anchor.href = '#';
    anchor.addEventListener('click', event => { event.preventDefault(); navigate(href); });
  }

  const content = parent.createDiv({ cls: 'docshelf-reading markdown-rendered' });
  const children = Array.from(fragment.children) as HTMLElement[];
  const blocks = children.filter(child => child.hasAttribute('data-docshelf-line-start'));
  let previousEnd = 0;
  const gap = (start: number, end: number) => {
    if (end < start) return;
    const group = content.createDiv({ cls: 'docshelf-reading-block docshelf-reading-gap' });
    const gutter = group.createDiv({ cls: 'docshelf-reading-gutter' });
    for (let line = start; line <= end; line++) selection.addButton(gutter, line);
  };
  for (const child of children) {
    if (!child.hasAttribute('data-docshelf-line-start')) { content.appendChild(child); continue; }
    const start = Number(child.dataset.docshelfLineStart);
    const end = Number(child.dataset.docshelfLineEnd);
    gap(previousEnd + 1, start - 1);
    previousEnd = end;
    const group = content.createDiv({ cls: 'docshelf-reading-block' });
    const gutter = group.createDiv({ cls: 'docshelf-reading-gutter', attr: { 'aria-label': 'Source lines' } });
    for (let line = start; line <= end; line++) selection.addButton(gutter, line);
    const body = group.createDiv({ cls: 'docshelf-block-content' });
    body.appendChild(child);
  }
  if (blocks.length) gap(previousEnd + 1, lineCount);
  if (!blocks.length && lineCount) {
    const group = content.createDiv({ cls: 'docshelf-reading-block' });
    const gutter = group.createDiv({ cls: 'docshelf-reading-gutter' });
    for (let line = 1; line <= lineCount; line++) selection.addButton(gutter, line);
    group.createEl('p', { text: 'These source lines have no rendered content. Switch to Source to see them.', cls: 'docshelf-muted' });
  }
  if (!lineCount) content.createEl('p', { text: 'This document is empty.', cls: 'docshelf-muted' });
}

function imageUrl(value: string, artifact: Artifact, server: DocumentServer): string | null {
  if (/^https:\/\//i.test(value)) return value;
  if (/^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(value)) return value;
  if (artifact.kind === 'github') {
    try {
      const url = new URL(value, artifact.rawUrl);
      return url.protocol === 'https:' ? url.href : null;
    } catch { return null; }
  }
  if (!artifact.sourcePath || /^[a-z][a-z\d+.-]*:|^\/\//i.test(value)) return null;
  try {
    const relative = path.posix.normalize(decodeURIComponent(value.split(/[?#]/)[0]));
    return artifact.assets?.includes(relative) ? server.assetUrl(artifact, relative) : null;
  } catch { return null; }
}
