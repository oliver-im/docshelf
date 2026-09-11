import { parseLineFragment } from './line-permalinks.js';
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
  const params = new URLSearchParams({ vault, source: sourceOf(artifact) });
  if (range) params.set('lines', range.start === range.end ? String(range.start) : `${range.start}-${range.end}`);
  // Obsidian URI dispatch uses decodeURIComponent, not form decoding: '+' is literal.
  return `obsidian://docshelf?${params.toString().replace(/\+/g, '%20')}`;
}

export function createAgentReference(artifact: Artifact, range: LineRange | null): string {
  const source = sourceOf(artifact);
  if (!range) return source;
  if (!artifact.sourcePath) return `${source}#L${range.start}${range.end === range.start ? '' : `-L${range.end}`}`;
  return `${source}:${range.start}${range.end === range.start ? '' : `-${range.end}`}`;
}

export function parseProtocol(params: Record<string, unknown>): { source: string; range: LineRange | null } {
  if ('path' in params) throw new Error('Use source= instead of path= in DocShelf links.');
  if (typeof params.source !== 'string' || !params.source || params.source.length > 8192 || params.source.includes('\0')) throw new Error('DocShelf link is missing a valid source.');
  return { source: params.source, range: parseRange(params.lines) };
}

export function checkRange(range: LineRange | null, lineCount: number): void {
  if (range && range.end > lineCount) throw new Error(`This document has ${lineCount} source lines; the link refers to line ${range.end}. The source may have changed.`);
}
