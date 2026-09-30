# Agent edits and the event log

When an agent edits a document on your shelf, for example after you give it feedback, DocShelf can mark that document unread in both apps, so the shelf shows which documents changed. Your own edits never do this. The filesystem records that a file changed but not who changed it, so agents announce their edits in an event log beside the shelf. An edit that no agent announces leaves the document read.

The same message format is designed to carry line comments between you and agents later. Version 1 implements one message type, `document.updated`.

## Announce edits from Claude Code

A Claude Code hook announces every edit Claude makes with its Edit and Write tools, without Claude having to remember anything. Hooks run only for Claude's own tool calls, never for your saves. Add this to your user settings in `~/.claude/settings.json`, replacing the path with your DocShelf checkout:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/docshelf/scripts/event.mjs updated --from-hook claude-code",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

The hook runs after every edit in every project. Files that are not on the shelf are skipped silently, and in hook mode the command always exits successfully, so it never interrupts Claude. The hook does not see files that Claude changes through shell commands such as `sed`; the written instruction below covers those. When Obsidian uses a shelf other than the checkout's `shelf.local.json`, add `--shelf /absolute/shelf.json --workspace /absolute/workspace` to the command.

## Announce edits from other agents

Agents without such a hook need a written instruction. Put it in the global guidance every session loads, such as `~/.codex/AGENTS.md` or `~/.claude/CLAUDE.md`, not only in the `docshelf` skill: the skill loads when an agent registers a document, not when it later edits one in response to your feedback.

```markdown
After editing a document registered in DocShelf, run `node /absolute/path/to/docshelf/scripts/event.mjs updated <file> --agent <your name>`, adding `--summary "<one line>"` when useful. It ignores files that are not on the shelf.
```

Announcing the same edit twice, for example from both a hook and the instruction, is harmless.

## The event command

```sh
node scripts/event.mjs updated <file> [--summary text] [--agent name] [--strict] [--shelf file] [--workspace dir]
node scripts/event.mjs updated --from-hook claude-code
```

- **Shelf:** the checkout's `shelf.local.json` (or a legacy `artifacts.local.json`), or `--shelf`. Without a local shelf, nothing is announced.
- **Workspace:** `--workspace` when given. Otherwise the home directory, which both apps use by default, unless the command runs without `--shelf` and `DOCSHELF_WORKSPACE` is set; that applies relative to the checkout, as in the web app. The shelf's own directory is always allowed.
- **Which files count:** a file registered explicitly, or discovered in a registered folder under the [discovery rules](folders.md#recursive-discovery): not excluded, hidden, inside a skipped folder, or larger than 8 MB. The command resolves symlinks and records the canonical path. Other files are skipped quietly with exit status 0; `--strict` reports them with exit status 1. A folder skipped for exceeding a scan limit still counts here, and the apps ignore announcements for documents they do not list.
- **Hook mode:** `--from-hook <agent>` reads the edited path from the hook's JSON input (`tool_input.file_path`, resolved against `cwd`), records the agent's name, prints nothing, and always exits with status 0.

## What the apps do

An announced document becomes unread again, even if you had read it, unless it is on screen in a focused window when the announcement arrives: the selected document in a visible, focused browser tab, or a document shown in a focused Obsidian window. You see those refresh, so they stay read. Opening a document marks it read as before. This covers the usual workflow: while you give feedback in a terminal, DocShelf is not focused, and the dot shows that the requested change has arrived.

Each app starts at the end of the log the first time it reads it, so earlier announcements are not replayed. It keeps its position with its read state, per browser for the web app and per vault and shelf for Obsidian. If the log is replaced or truncated, the app continues from the new end.

The web app reads the log through the local watcher at `/__docshelf/events`, with the same loopback and request checks as its other local actions, during its three-second update checks in visible tabs. The browser receives only the opaque IDs of documents in the served build, never local paths. Static hosting has no log. Restart a running watcher after updating DocShelf to enable the endpoint. Obsidian watches the log beside its configured shelf.

## Event format

Each shelf has its own log in the same directory, named after the shelf file without `.json`: `shelf.local.json` logs to `shelf.local.events.jsonl`. The log is UTF-8 JSON Lines, one event per line, and is only ever appended to. Writers take a lock beside the shelf (`.shelf.local.json.events.lock`) and append each event as one write. Git ignores the log. A shelf inside an Obsidian vault puts its log in the vault, where a sync service may copy it to other devices.

```jsonl
{"v":1,"id":"6f1c2d4e-0000-4000-8000-000000000001","at":"2026-09-28T11:40:00Z","from":{"role":"agent","name":"claude-code"},"type":"document.updated","subject":{"source":"/Users/me/projects/app/docs/plan.md","revision":"sha256:…"},"body":{"text":"Reordered the rollout steps."}}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `v` | Yes | Format version, `1`. Readers skip lines with a later version. |
| `id` | Yes | Unique event ID; the command uses a random UUID. Letters, digits, and `.`, `_`, `:`, `-`, at most 128 characters. |
| `at` | Yes | UTC time the writer appended the event, in ISO 8601. Informational only; order is file order. |
| `from.role` | Yes | `agent` or `user`. Each side acts on the other's events. |
| `from.name`, `from.app` | No | Agent name, such as `claude-code` or `codex`, or app, `web` or `obsidian`. Informational only. |
| `type` | Yes | Dotted lowercase event type. Readers ignore types they do not know. |
| `subject.source` | For document events | The document: an absolute canonical path for a local file, or its public URL for a remote document. |
| `subject.lines` | No | `{ "start": n, "end": m }`, 1-based and inclusive, matching line links. |
| `subject.revision` | No | `sha256:<hex>` of the document bytes the event refers to. |
| `re` | No | The `id` of an earlier event that this one answers or resolves. |
| `body.text` | No | Plain text, never rendered as HTML. |
| `body.quote` | Reserved | A copy of the commented lines at `subject.revision`, so a comment can find its lines after the document changes. |

A line may be at most 16 KiB, `body.text` and `body.quote` at most 8,192 characters, and no text may contain NUL characters. Readers skip invalid lines with a warning, and ignore fields they do not know. Apps ignore events for documents that are not on their shelf.

### `document.updated`

An agent writes this after changing a registered document you should look at. `subject.source` is required. `subject.revision` should be the hash of the bytes the agent wrote; the command adds it. `body.text` is an optional one-line summary. The apps act only on events whose `from.role` is `agent`, and do not write this type themselves. An app marks the document unread even when the revision no longer matches the current content, because the agent may have edited it again since.

### Reserved for line comments

Later versions may add `comment.created`, written by an app when you comment on a line link, with `from.role` of `user`, `subject.lines`, `subject.revision`, `body.text`, and `body.quote`; and `comment.replied` and `comment.resolved`, written by an agent or by you, with `re` pointing to the comment. Version 1 accepts these lines as valid and ignores them.

## Privacy

- The log stays local, is ignored by Git, and is never published by the web build.
- Events name local paths. The web endpoint returns only the opaque IDs of documents in the served build, and only to the local interface.
- An event only refers to a registered document; it never makes an app read any other file.
