import { announcedUpdates } from '@docshelf/core/events';
import { parseClaudeArtifactUrl } from '@docshelf/core/claude-artifacts';
import { endCursor, readEvents } from '../packages/local/events.mjs';

/**
 * Read agents' update announcements for the browser. Sources are reported only as the
 * opaque `sourceId` of documents in the served build, so the page never receives local paths.
 *
 * @param {{
 *   logPath: () => Promise<string>,
 *   sourceIds: () => Map<string, string> | null,
 *   warn?: (message: string) => void,
 * }} options `sourceIds` maps each served document's canonical source to its ID, or is null before a build is served.
 */
export function createAnnouncementReader({ logPath, sourceIds, warn = () => {} }) {
  /** @param {{ after?: number, last?: string }} position @returns {Promise<{ cursor: import('../packages/local/events.mjs').EventCursor, sources: string[] } | null>} */
  return async ({ after, last }) => {
    const served = sourceIds();
    if (!served) return null;
    const file = await logPath();
    // A browser without a position starts at the end, so earlier announcements are not replayed.
    if (after === undefined) return { cursor: await endCursor(file), sources: [] };
    const result = await readEvents(file, { offset: after, lastId: last ?? null });
    for (const warning of result.warnings) warn(warning);
    const sources = announcedUpdates(result.events).flatMap(source => served.get(parseClaudeArtifactUrl(source)?.publicUrl || source) ?? []);
    return { cursor: result.cursor, sources: [...new Set(sources)] };
  };
}
