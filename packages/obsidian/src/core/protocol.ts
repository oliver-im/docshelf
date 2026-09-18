import { parseLineFragment } from '@docshelf/core/line-permalinks';
import { createObsidianLink, createSourceReference } from '@docshelf/core/links';
import type { Artifact, LineRange } from './types';

export function parseRange(value: unknown): LineRange | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^[1-9]\d*(?:-[1-9]\d*)?$/.test(value)) throw new Error('Line range must look like 7 or 7-11.');
  const [start, end = start] = value.split('-');
  const parsed = parseLineFragment(`#L${start}-L${end}`);
  if (!parsed) throw new Error('Line range must contain ordered, positive safe integers.');
  return parsed;
}

export function sourceOf(artifact: Artifact): string { return artifact.sourcePath || artifact.source; }

export function createPermalink(vault: string, artifact: Artifact, range: LineRange | null): string {
  return createObsidianLink(vault, sourceOf(artifact), range);
}

export function createAgentReference(artifact: Artifact, range: LineRange | null): string {
  return createSourceReference(sourceOf(artifact), Boolean(artifact.sourcePath), range);
}

export function parseProtocol(params: Record<string, unknown>): { source: string; range: LineRange | null } {
  if ('path' in params) throw new Error('Use source= instead of path= in DocShelf links.');
  if (typeof params.source !== 'string' || !params.source || params.source.length > 8192 || params.source.includes('\0')) throw new Error('DocShelf link is missing a valid source.');
  return { source: params.source, range: parseRange(params.lines) };
}

export function checkRange(range: LineRange | null, lineCount: number): void {
  if (range && range.end > lineCount) throw new Error(`This document has ${lineCount} source lines; the link refers to line ${range.end}. The source may have changed.`);
}
