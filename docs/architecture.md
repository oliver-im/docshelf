# Architecture

DocShelf preserves project ownership of documents. The plugin reads an explicit
shelf and displays sources through custom `ItemView`s; it does not manufacture
vault files or intercept native editors.

## Data flow

1. The shelf loader canonicalizes the configured roots and validates each
   registration, its source type, unique identity, and optional asset list.
2. The plugin reads bounded source snapshots and builds a MiniSearch index.
   Chokidar watches explicit source, asset, and shelf paths. A queued refresh
   publishes a validated catalog and updates affected views. Invalid shelf
   changes retain the last valid catalog with an error; file reads still enforce
   current path checks.
3. Markdown is parsed with source positions, stripped of authored raw HTML,
   sanitized, and displayed in the host with rewritten image and link targets.
   The source mode inserts text through DOM text APIs. Both share source-line
   range state and clipboard helpers.
4. Local HTML loads in a separate webview from the plugin's loopback server.
   Every request must carry the random path token and correct Host. The server
   accepts only GET/HEAD and serves registered HTML plus explicitly listed
   assets, rechecking path containment and byte limits. Registered document
   links are rewritten in the served copy; no original files are changed.
5. A custom URI handler uses `vault` for host dispatch and `source` for lookup
   against the loaded catalog. It never auto-registers URI-supplied paths.

## HTML boundary

Electron warns that `file://` has broader privileges than browser file pages.
The webview therefore uses HTTP, a nonpersistent partition separate from
Obsidian and remote artifact pages, context isolation, no Node, and sandboxing.
The report response adds a CSP sandbox and denies frames, objects, workers,
forms, and access to file/app schemes. Scripts may use self/HTTPS resources.

The installed Obsidian host additionally strips webview preloads, enforces Node
and sandbox settings, and prevents non-HTTP(S) guest navigation. These are host
implementation details, which is why the plugin currently requires the tested
Obsidian 1.13.7 renderer and includes an actual-host regression runner.

A passing check demonstrates the exercised behavior on that runtime. It does
not prove the absence of Electron vulnerabilities or guarantee compatibility
with all future builds. The server's allowlist remains necessary independently
of renderer flags.

Sources: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[protocol session scope](https://www.electronjs.org/docs/latest/api/protocol),
[Obsidian API](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts).

## Deferred integration

Mirroring could add native vault indexing. Write-back would require a separate
synchronization design: checking a hash before writing does not atomically
exclude concurrent external edits. Native reading-view section highlights also
do not reproduce DocShelf's per-line controls. Neither is required by the
read-only external-document workflow implemented here.
