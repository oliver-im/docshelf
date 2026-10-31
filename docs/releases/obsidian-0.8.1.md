# DocShelf for Obsidian 0.8.1 — desktop beta

Fix the community build verifier's failure on the independent web app. The default build now produces the shared declarations and Obsidian plugin without invoking Astro, whose Node requirement exceeds the verifier's Node 22.23.3. The aggregate build still builds both apps on Node 24, and CI also verifies the plugin build with the scanner's Node version.

The plugin code and styles match 0.8.0. Global document pins, shared read status, settings, shelves, and recovery records remain unchanged. No migration is required.

## Install or update

Use Obsidian's Community plugins settings to check for updates, or open the [community listing](https://community.obsidian.md/plugins/docshelf). For a manual install, download `docshelf-0.8.1.zip`, extract it, and copy its `docshelf` folder into `<vault>/.obsidian/plugins/`. Preserve **`data.json`** and **`recovery/`** when replacing an existing installation. `SHA256SUMS` covers the ZIP and standalone assets; the three standard install assets have GitHub provenance attestations.

## Verification and limits

Requires desktop Obsidian **1.13.7 or later**. The unchanged 0.8.0 runtime passed the full packaged suite on macOS with Obsidian **1.14.5**. This patch checks aggregate builds, package integrity, and the plugin build on the verifier's Node version. Windows and Linux runtime behavior remain unverified; mobile is unsupported. The [community review notes](https://github.com/oliver-im/docshelf/blob/main/docs/obsidian-review.md) document the remaining advisories and intentional capabilities.
