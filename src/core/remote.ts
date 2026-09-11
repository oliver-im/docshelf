import https from 'node:https';
import { parseGitHubMarkdownUrl } from './github-markdown.js';
import { MAX_REMOTE_BYTES } from './types';

/** Buffer only after enforcing the limit on each received chunk. */
export function fetchGitHubMarkdown(url: string, signal?: AbortSignal, redirects = 0): Promise<string> {
  const parsed = parseGitHubMarkdownUrl(url);
  if (!parsed || new URL(parsed.rawUrl).host !== 'raw.githubusercontent.com') return Promise.reject(new Error('Invalid public GitHub Markdown URL.'));
  if (redirects > 3) return Promise.reject(new Error('GitHub returned too many redirects.'));
  return new Promise((resolve, reject) => {
    const request = https.get(parsed.rawUrl, { signal, headers: { Accept: 'text/plain', 'Accept-Encoding': 'identity' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        response.resume();
        const location = response.headers.location;
        if (!location) { reject(new Error('GitHub returned a redirect without a location.')); return; }
        const next = new URL(location, parsed.rawUrl).href;
        if (new URL(next).hostname !== 'raw.githubusercontent.com' || !parseGitHubMarkdownUrl(next)) {
          reject(new Error('GitHub redirected outside the allowed Markdown source.')); return;
        }
        fetchGitHubMarkdown(next, signal, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`GitHub returned HTTP ${response.statusCode}.`)); return; }
      if (Number(response.headers['content-length']) > MAX_REMOTE_BYTES) { response.destroy(); reject(new Error('GitHub Markdown exceeds the 2 MB limit.')); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_REMOTE_BYTES) { response.destroy(new Error('GitHub Markdown exceeds the 2 MB limit.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks, size).toString('utf8')));
      response.on('error', reject);
    });
    request.setTimeout(15_000, () => request.destroy(new Error('GitHub request timed out.')));
    request.on('error', reject);
  });
}
