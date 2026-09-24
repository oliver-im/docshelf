# Obsidian community review

The community review of plugin `0.2.0` (commit `9423f43`) scanned the entire repository, including the independent web app and the registration skill's stylesheet. This document records the findings, their fixes, and the deliberate capabilities that remain. The [official linter configuration](https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md) describes the scanner; [upstream issue 178](https://github.com/obsidianmd/eslint-plugin/issues/178) tracks findings on non-plugin code in shared repositories. A local linter configuration does not guarantee the hosted scanner will use the same scope or types.

## Published review baseline

On September 24, 2026, the hosted review of `0.2.2` (commit `2660976`) was **Completed** without errors. Its release assets had valid attestations, no reported vulnerable dependencies or obfuscation, and a byte-for-byte reproduced `main.js`. The public listing reported **Excellent** health and **Caution** for the review: 261 warnings and two recommendations.

| Warning group | Count | Scope |
| --- | ---: | --- |
| Unsafe types | 211 | Independent web app |
| Browser DOM creation and networking | 19 | Independent web app |
| CSS compatibility and style rules | 27 | Web app and standalone registration skill theme |
| Filesystem access, process inspection, and CSS overrides | 4 | Plugin and its shared lock helper |

The recommendations concern optional release attachments and user-triggered clipboard writes. The browser type fixes below follow that published review; their local checks do not establish a new hosted warning count. The missing contributing guide and outdated installation text have also been corrected.

## Fixed findings

| Finding | Resolution |
| --- | --- |
| Unsafe `innerHTML` in web Mermaid rendering | Sanitize renderer output with the bundled DOMPurify before inserting a DOM fragment. Permit Mermaid's SVG HTML labels while sanitizing their children, attributes, and URLs; preserve the source fallback if rendering or sanitization fails. Browser tests cover labels, theme changes, active markup, and a missing sanitizer. |
| Static `innerHTML` in the web document menu | Construct the SVG icon with DOM methods. |
| Unnecessary SVG namespace assertion | Pass the nullable namespace accepted by `createElementNS` directly. |
| Unsafe web action responses and async event listeners | Validate server JSON records and removal previews, use a window timer, and invoke handled async actions from void event callbacks. |
| Untyped browser scripts, DOM elements, and library integrations | Enable strict JavaScript type checking, declare browser DOM libraries, and use the installed Mermaid, DOMPurify, and Marked types. Narrow DOM nodes before accessing element-specific APIs, validate incoming messages from `unknown`, and keep source-line metadata in typed maps. Ignore malformed outline fragments and incomplete table markup without stopping the remaining reader controls. |
| Unsafe types in plugin parsing, HTML traversal, search, saved settings, and suggestion rendering | Narrow untrusted values from `unknown`; use parse5 node types and Obsidian's `FuzzyMatch` type. Shared folder parsing validates every field and exclusion before returning typed values. |
| Unnecessary Markdown assertion | Use the defined regex match index directly. |
| Bare timers and animation frames in plugin code | Use window timers for plugin lifecycle work, the view's own window for UI callbacks, and Node's promise timer for filesystem search indexing. |
| CommonJS imports | Use typed imports for the desktop host's Electron and remote APIs; those modules remain external to the bundle. |
| Detached DOM elements in source gutters | Use Obsidian creation helpers and adopt the detached nodes into the editor's document. |
| Settings absent from settings search | Supply declarative setting definitions with named custom renderers, preserving the explicit Save and reload action and the immediate vault display preference. |
| Build verifier cannot find `main.js` | The root build builds both apps and stages the plugin's three install files in ignored `build/`. Web-only builds remain available as `npm run build:web`; the watcher still builds only Astro. The staging script refuses symlink outputs. |
| No release asset attestations | The plugin release workflow attests `main.js`, `manifest.json`, and `styles.css` using GitHub Actions provenance. This applies to releases built by the updated workflow. |
| Duplicate `overflow-x` declaration | Remove the redundant web stylesheet fallback. |

`npm run lint` checks unsafe types and DOM insertion against both apps' own TypeScript projects, applying Obsidian API conventions only to the plugin. `npm run check:web-scripts` type-checks the browser scripts; it also runs as part of the standard web check. Astro generates its content types before lint and standalone script checks. These checks are included in `npm run check:all` and CI. They complement the hosted review rather than claiming to reproduce every scanner configuration.

## Reviewed capabilities and recommendations

| Finding | Disposition |
| --- | --- |
| Direct filesystem access | Required to open and edit explicitly registered files outside the vault. Reads and writes retain canonical workspace containment, registration checks, file identity and baseline checks, and draft recovery. Using the vault API would change the product's purpose. |
| Shell execution | The shared lock helper uses `execFile('ps', [...])` with fixed arguments, a validated process ID, no shell, and a five-second timeout to identify a lock owner. Linux prefers `/proc`. Keep this identity check so the plugin does not break another app's active lock. No document text or shelf paths are executed as commands. |
| Clipboard access | The plugin writes links and source references only after a user action. It does not read clipboard contents. |
| Extra release files | Keep the manual-install ZIP, licenses, dependency notices, and checksums. Obsidian installs only the three standard files; dependency licenses are also embedded in `main.js`. These attachments are intentional and not runtime dependencies. |
| Two plugin CSS `!important` declarations | Required to override the host's inline display state when a source is unavailable and CodeMirror's own `display: flex !important` on the native line-number gutter. Removing them can expose an unavailable editor or duplicate source labels. Both are narrowly scoped and documented in the stylesheet. |
| Unbound host method | The native Markdown adapter intentionally saves the exact host method for restoration and calls an explicitly bound copy. A single documented lint exception covers that identity-preserving capture. |
| Custom webview creation | The `0.2.1` hosted scan rejected the local lint exception. Version `0.2.2` extends the element tag map with Electron's webview type, uses Obsidian's `createEl`, and adopts the detached element into the owning view's document. Each guest is attached only after its private session and sandbox are configured. Local HTML guests also receive a navigation guard before attachment; remote Claude Artifact guests do not use that local-document guard. |
| Web `fetch`, DOM creation, and browser globals | These are native browser APIs used by the independent web app. Obsidian APIs are not available in its pages. Do not replace browser networking with Obsidian's `requestUrl` or add a plugin runtime dependency to the web app. |
| Hosted scanner scope and type resolution | Both apps now have typed local checks. The hosted scanner applies its own TypeScript setup and may still flag browser APIs and unrelated styles. Upstream issue 178 remains open; local ignores or rule overrides are not a reliable hosted scope control. Keep the independent apps' actual runtime types and validation rather than adding blanket casts, suppressing unsafe-type checks, or relocating sources to hide them from review. |
| CSS feature warnings against Obsidian 1.11.4 | The flagged web stylesheet and skill theme are not installed in the plugin, which requires Obsidian 1.13.7. The skill's `:has`, multicolumn, `display: contents`, and `!important` rules apply to standalone reports. Do not change unrelated themes to satisfy a plugin compatibility target they do not use. |

## Recheck a release

Run the aggregate checks, package checks, and disposable-vault runtime suite before publishing. Verify the staged `build/main.js` matches the packaged release asset and verify GitHub attestations for the published files. In the community account, choose **More actions → Check for new releases**, then inspect the review of the new exact tag and commit. A successful local check or queued review is not proof that the hosted review passed.
