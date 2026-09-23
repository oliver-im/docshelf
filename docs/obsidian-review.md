# Obsidian community review

The community review of plugin `0.2.0` (commit `9423f43`) scanned the entire repository, including the independent web app and the registration skill's stylesheet. This document records the findings, their fixes, and the deliberate capabilities that remain. The [official linter configuration](https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md) describes the scanner; [upstream issue 178](https://github.com/obsidianmd/eslint-plugin/issues/178) tracks findings on non-plugin code in shared repositories. A local linter configuration does not guarantee the hosted scanner will use the same scope or types.

## Fixed findings

| Finding | Resolution |
| --- | --- |
| Unsafe `innerHTML` in web Mermaid rendering | Sanitize renderer output with the bundled DOMPurify before inserting a DOM fragment. Permit Mermaid's SVG HTML labels while sanitizing their children, attributes, and URLs; preserve the source fallback if rendering or sanitization fails. Browser tests cover labels, theme changes, active markup, and a missing sanitizer. |
| Static `innerHTML` in the web document menu | Construct the SVG icon with DOM methods. |
| Unnecessary SVG namespace assertion | Pass the nullable namespace accepted by `createElementNS` directly. |
| Unsafe web action responses and async event listeners | Validate server JSON records and removal previews, use a window timer, and invoke handled async actions from void event callbacks. |
| Unsafe types in plugin parsing, HTML traversal, search, saved settings, and suggestion rendering | Narrow untrusted values from `unknown`; use parse5 node types and Obsidian's `FuzzyMatch` type. Shared folder parsing validates every field and exclusion before returning typed values. |
| Unnecessary Markdown assertion | Use the defined regex match index directly. |
| Bare timers and animation frames in plugin code | Use window timers for plugin lifecycle work, the view's own window for UI callbacks, and Node's promise timer for filesystem search indexing. |
| CommonJS imports | Use typed imports for the desktop host's Electron and remote APIs; those modules remain external to the bundle. |
| Detached DOM elements in source gutters | Use Obsidian creation helpers and adopt the detached nodes into the editor's document. |
| Settings absent from settings search | Supply declarative setting definitions with named custom renderers, preserving the explicit Save and reload action and the immediate vault display preference. |
| Build verifier cannot find `main.js` | The root build builds both apps and stages the plugin's three install files in ignored `build/`. Web-only builds remain available as `npm run build:web`; the watcher still builds only Astro. The staging script refuses symlink outputs. |
| No release asset attestations | The plugin release workflow attests `main.js`, `manifest.json`, and `styles.css` using GitHub Actions provenance. This applies to releases built by the updated workflow. |
| Duplicate `overflow-x` declaration | Remove the redundant web stylesheet fallback. |

`npm run lint` checks the reported type/API rules against the actual plugin TypeScript project and unsafe DOM insertion across plugin and web code. It is included in `npm run check:all` and CI. This complements the hosted review rather than claiming to reproduce every scanner configuration.

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
| Web JavaScript unsafe-type findings | The hosted scanner applies its own TypeScript setup to browser scripts and shared JavaScript. The plugin's typed runtime is checked locally; remaining browser-script findings need interpretation in their actual web context, not blanket casts or disabled runtime validation. |
| CSS feature warnings against Obsidian 1.11.4 | The flagged web stylesheet and skill theme are not installed in the plugin, which requires Obsidian 1.13.7. The skill's `:has`, multicolumn, `display: contents`, and `!important` rules apply to standalone reports. Do not change unrelated themes to satisfy a plugin compatibility target they do not use. |

## Recheck a release

Run the aggregate checks, package checks, and disposable-vault runtime suite before publishing. Verify the staged `build/main.js` matches the packaged release asset and verify GitHub attestations for the published files. In the community account, choose **More actions → Check for new releases**, then inspect the review of the new exact tag and commit. A successful local check or queued review is not proof that the hosted review passed.
