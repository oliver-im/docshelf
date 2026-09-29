import { createEvent } from '@docshelf/core/events';
import { appendEvent } from '../../packages/local/events.mjs';

/**
 * Child process used by the event log tests to append events concurrently with other writers.
 *
 *   node event-child.mjs <shelfPath> <writer> <count>
 *
 * Each event's text is long enough that an unsynchronized append could interleave with another.
 */
const [shelfPath, writer, count] = process.argv.slice(2);
for (let index = 0; index < Number(count); index += 1) {
  await appendEvent(shelfPath, createEvent({
    from: { role: 'agent', name: writer },
    type: 'document.updated',
    subject: { source: `/${writer}/${index}.md` },
    body: { text: `${index}:`.padEnd(6000, writer) },
  }));
}
