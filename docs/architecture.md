# Architecture

DocShelf preserves project ownership of documents. The plugin reads an explicit
shelf and opens local Markdown in a `MarkdownView` subclass with `allowNoFile`.
The host supplies its native editor and preview; DocShelf supplies external-file
loading, saving, and recovery through the public view lifecycle. There are no
fake `TFile`s, vault-index injection, copied notes, or patched host prototypes.
HTML and remote sources retain read-only custom `ItemView`s.

Local Markdown keeps source-reference selection inside the same native editor.
A CodeMirror gutter marks document lines and the source ranges represented by
block widgets. Its reference state is separate from the native text selection,
so choosing lines for review does not move the caret or reveal Markdown syntax.
Source positions map through editor changes; line decorations highlight the
reference and the existing clipboard commands use it. Native text selection
clears the gutter reference. Only the positional range is saved in workspace
state. The extension is scoped to DocShelf editors.

## Data flow

1. The shelf loader canonicalizes the configured roots and validates each
   registration, its source type, unique identity, and optional asset list.
   At runtime, unavailable files retain their registrations; the CLI validator
   still requires every file to be available. Reads always recheck containment.
2. The plugin reads bounded source snapshots and builds a MiniSearch index.
   Chokidar observes their parent directories with an explicit allowlist of
   source, asset, and shelf paths. Other files are ignored. A queued refresh
   publishes a validated catalog and updates affected views. Invalid shelf
   changes retain the last valid catalog with an error; file reads still enforce
   current path checks. Missing files produce individual errors without blocking
   healthy documents. Parent watches detect restored files reliably; a changed
   allowlist replaces the watcher and triggers a refresh after startup.
3. Local Markdown uses the native Markdown editor, Live Preview, and reading
   view. GitHub Markdown is parsed with source positions, stripped of authored
   raw HTML, sanitized, and displayed in the read-only host view. Both support
   source-line range links and references. Local images remain explicitly
   registered assets; external links between documents resolve via the shelf.
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

## Native Markdown persistence

`NativeMarkdownView` uses the host's editor buffer. `requestSave` first persists
a private recovery record and then schedules the host's normal save callback.
`save` writes only local Markdown still registered at the same source path. It
rechecks canonical containment, compares the file descriptor with the current
path, compares bytes with the loaded baseline, writes through that descriptor,
flushes it, and verifies the resulting bytes and file identity. It never opens
with create/truncate flags. The source inode and permissions are preserved.

The recovery record contains the baseline bytes, edited text, original source,
route, and a pane-specific ID. Workspace state contains only the ID and normal
view state, not document contents. Pending drafts survive close/restart and are
offered for review before writing. Each pane keeps its own record so conflicts
between two panes cannot replace each other's recovery copies.

Clean editors adopt external updates. Dirty editors retain their buffer and
block saves on conflicts, missing sources, or removed/changed registrations.
The comparison dialog allows merging or choosing a version; the reviewed disk
snapshot becomes the baseline for another checked save. HTML server routes are
still GET/HEAD only and expose no editor or write bridge.

Filesystem checks are not a cross-process compare-and-swap. Another application
can write in the interval between checking and writing; recovery retains the
versions DocShelf observed, not every intermediate external version. The code
does not claim to prevent all races with arbitrary external writers.

The native editor view has no vault file. Text editing and editor extensions are
available; vault indexing, properties tied to a `TFile`, backlinks, graph, Sync,
and file-dependent third-party plugins remain outside this integration.
