---
name: docshelf
description: Register local HTML or Markdown documents and published Claude Artifacts with DocShelf when the user asks to add them to the shelf, preserving their sources and verifying the resulting local URLs.
---

# DocShelf

## Find DocShelf

- Use `DOCSHELF_ROOT` when it points to a DocShelf checkout.
- Otherwise, use the current repository when it is DocShelf or find an unambiguous sibling `docshelf` checkout.
- If no checkout can be identified safely, ask the user where DocShelf is installed.

## Register the artifact

- Resolve “this” from an explicitly named, attached, current, or just-created
  file, or from an explicitly supplied published Claude Artifact URL. If more
  than one source is plausible, ask which one.
- When creation and registration are requested together, register only after the
  source artifact has been finished and verified by the authoring task.
- Accept only HTML or Markdown files supported by DocShelf and contained within
  its workspace, or an exact public HTTPS Claude Artifact link of the form
  `claude.ai/public/artifacts/<id>`. Do not register other remote URLs.
- Read DocShelf's `AGENTS.md` and the registration section of its `README.md` before changing the shelf.
- Add the source to `shelf.local.json`, creating that file from `shelf.json` if needed. Never add registrations to `shelf.json`.
- Preserve existing registrations and update an existing entry instead of creating a duplicate.
- Infer metadata without asking when it is clear:
  - derive `project` from the owning repository or project directory;
  - store local `source` paths relative to the DocShelf checkout, and store
    Claude Artifact sources as their canonical public links;
  - use a stable, lowercase `<project>/<document>.html` route;
  - take `title` from the document title or primary heading, falling back to a humanized filename;
  - write a short factual `description` based on the document's purpose.
- Ask only when the source or required metadata cannot be inferred safely.
- For a Claude Artifact, tell the user that its owner must add the DocShelf
  origin to the Artifact's **Allowed domains** in Claude's **Get embed code**
  settings. Do not download or modify the Artifact.
- Before changing the shelf, probe
  `http://shelf.localhost:<port>/__docshelf/status`. If it is available, record
  its `instanceId` and `generation` so the resulting rebuild can be identified.
- Do not modify the source artifact, commit machine-local registrations, or edit
  generated DocShelf files.

## Verify the result

- If the DocShelf watcher is running, let it rebuild; never start a second watcher for verification.
- When a watcher status was recorded before registration, poll the status endpoint
  for up to 150 seconds. Wait for a terminal `ready` or `failed` state from a newer
  generation of the same instance, or from a replacement instance. On `failed`,
  stop waiting and report `error.message`, using the bounded `error.details` when
  useful for diagnosis. Do not mistake the older `ready` state for this rebuild.
- After a `ready` result, confirm that the registered route is available and
  reflects the current source. If no watcher is running, validate with DocShelf's
  sync and build commands without installing or starting a daemon unless requested.
- Return the stable URL in the form
  `http://shelf.localhost:4321/?artifact=<encoded-route>` at the default port;
  when `DOCSHELF_PORT` is set, use its value instead of `4321`.
- If the local server is unavailable, report the successfully validated route and say that it will be served when DocShelf runs.
