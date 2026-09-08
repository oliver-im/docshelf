# Using DocShelf

See the [README](https://github.com/oliver-im/docshelf/blob/main/README.md) for installation and local source registration.

## Browser imports

Use the plus button in the DocShelf header on either the local site or the
hosted GitHub Pages site. Paste a public GitHub Markdown file or published
Claude Artifact URL, optionally give it a name, and DocShelf remembers it in
that browser. Browser imports do not change a shelf file or make the imported
link available to other visitors.

For Markdown, DocShelf accepts only HTTPS `.md` and `.markdown` file URLs on
`github.com` and `raw.githubusercontent.com`. It fetches the public raw file
directly in the browser, omits raw HTML, sanitizes the result, and renders it
with the DocShelf Markdown theme. Relative images resolve from the raw file's
directory, while relative links from a GitHub file-view URL point back into the
same repository. General GitHub pages and arbitrary remote hosts are rejected.
Private repositories and authenticated requests are not supported.

Imported Markdown is fetched again after a page reload. It is not copied into
the built site, available offline, or included in full-text search. It retains
DocShelf's source-line selection and permalink behavior, while its repository
remains the source of truth.

### Published Claude Artifacts

Unlike browser-imported Markdown, a published Claude Artifact can also be
included for everyone who uses a built shelf by registering its public link in
the shelf JSON:

```json
{
  "project": "Claude Artifacts",
  "source": "https://claude.ai/public/artifacts/12345678-90ab-cdef-1234-567890abcdef",
  "route": "claude/system-explorer.html",
  "title": "System explorer",
  "description": "An interactive system explorer published from Claude."
}
```

DocShelf accepts only exact HTTPS links of the form
`claude.ai/public/artifacts/<id>` (the `/embed` form is accepted and normalized
too). It embeds Claude's dedicated cross-origin `/embed` page; a Claude chat,
home page, or other arbitrary URL is rejected. The Artifact owner must use
Claude's **Get embed code** settings to add the complete DocShelf origin—such
as `https://oliver-im.github.io` or `http://shelf.localhost:4321`—to **Allowed
domains**. See Claude's
[publishing and sharing instructions](https://support.claude.com/en/articles/9547008-publish-and-share-artifacts).

Claude remains the content host. These entries are therefore not copied into
DocShelf, included in full-text search, given Markdown source-line links, or
available offline. Unpublishing an Artifact or removing the DocShelf origin
from its allowed domains makes the embedded content unavailable.

## Using the viewer

Choose an artifact in the left sidebar or search results to load it inside
DocShelf. Search results for a section jump to that heading. For local artifacts,
use a modified click or the browser's link menu to open the standalone generated
page.

- `Command/Ctrl+B` toggles the artifact sidebar.

Each sidebar document has a **⋯** actions button, visible on hover or keyboard
focus and always visible on touch devices. Its menu offers **Open in new tab**
and **Copy link**; the selected document's copied link includes its current
section or line selection. GitHub and Claude documents also offer **View source**.
Normal browser right-click actions remain available.

Website links in registered documents open in a new tab by default. Explicit
HTML targets are preserved except for `_self`, which also opens a new tab for
website links. Heading links stay within the current document, and links to
other registered sources navigate the shelf.

When the loopback watcher is running on macOS, registered local files also offer
**Reveal in Finder**, which selects the original source file in its folder.
This action is unavailable on the hosted demo, in Astro dev/preview, on other
operating systems, or when the watcher is bound to a network interface. Use
Enter or Space to open the menu, arrow keys to move between actions, and Escape
to close it. Restart an already-running watcher after updating its server code.

Drag the divider beside the sidebar to change its width. When the divider has
keyboard focus, the arrow keys resize it in smaller steps. The width and
visibility preferences are stored in the browser.

The selected artifact is written to the page URL, so a viewer state can be
bookmarked. For a browser-imported document, that bookmark works in the same
browser because the source link is stored locally; the bookmark alone does not
transfer the import to someone else. The viewer keeps the current document
visible while a selected or updated artifact loads in a hidden frame, then
swaps frames after the new document is ready. While `npm run watch` is running,
local content revisions are checked when the window regains focus and every few
seconds while it remains visible.

Rendered Markdown also supports source-line links. Its gutter shows every source
line, including blank lines and lines omitted from the rendered document. Click
a number to select that exact source line, then Shift-click another number to
extend the range. Gutter positions and selection bands are distributed within
the rendered block; they identify source lines, which may differ from the
visible rows after paragraph wrapping. The range is written to the URL using the familiar
`#L14-L20` form. Use **Copy link** in the document's **⋯** menu in the sidebar
to share the exact artifact and range.

## Markdown rendering

Registered Markdown artifacts support GitHub-flavored tables, task lists,
strikethrough, heading anchors, syntax-highlighted fenced code, and Mermaid
diagrams. Put Mermaid syntax in a fenced code block with the `mermaid` language
identifier, as on GitHub. DocShelf loads its bundled Mermaid runtime only for
Markdown documents that contain one of these blocks. YAML or TOML frontmatter
is removed from the rendered document; a valid `lang` frontmatter value sets
the HTML document language.

Both registered and browser-imported Markdown use an adapted Tokyo Night
reading theme with a centered, readable text column. Its light or dark appearance
follows DocShelf, including theme changes made while the document is open.
Paragraphs use normal Markdown wrapping: single source newlines flow as spaces,
while blank lines separate paragraphs. Two trailing spaces or a backslash
preserve an intentional line break. Code blocks retain their line breaks.
Browser imports support GitHub-flavored Markdown, heading anchors, and source-line
links, but do not run Mermaid or syntax-highlighting scripts. Existing HTML
artifacts retain their own styles.

Registered Markdown documents with three or more named, authored second-level
headings get an **On this page** outline, including nested third-level headings.
It sits beside the document when there is room and collapses into a sticky menu
on narrower screens. Wide tables scroll independently with a visible hint; focus
a scrolling table to move through its columns with the arrow keys.
Outline links update the viewer URL, so sections can be bookmarked and restored
with Back and Forward. Source-line numbers and permalink selections remain tied
to the original Markdown as the text reflows across these layouts.

Raw HTML inside Markdown is omitted. Use a registered HTML artifact when a
document needs custom markup or scripts. Browser-imported GitHub Markdown
resolves relative images through GitHub's raw file host. A registered local
Markdown artifact cannot load an unregistered neighboring image because
DocShelf does not serve surrounding project directories. Relative image paths
that point into DocShelf's own `public/` directory use the bundled asset, with
the deployment's URL prefix applied. This lets the README's screenshot work in
both a local shelf and the Pages demo.
