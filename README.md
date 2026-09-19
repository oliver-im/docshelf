# DocShelf

Browse Markdown and HTML documents across your projects.

## Key features

- **A shelf across projects.** Register Markdown and HTML files where they live, and view them in Obsidian or in the browser.
- **Links to exact passages.** Select Markdown source lines and copy the link (`obsidian://docshelf` for Obsidian, `https://shelf.localhost/` for the web app after local setup).

**[DocShelf Web Demo](https://oliver-im.github.io/docshelf/?artifact=docshelf%2Freadme.html)**

## Why DocShelf?

Project notes, design documents, and agent-generated reports belong beside the work they describe. But as they spread across repositories, finding and reading them becomes a chore. DocShelf brings the documents you choose into one shelf, while also providing a way to select the lines, similar to GitHub permalink, to easily discuss the exact content with the agent.

## Choose your app

Use either app independently, or [point both at the same shelf](https://github.com/oliver-im/docshelf/blob/main/docs/unification.md#use-one-shelf).

### DocShelf Web

Read Markdown, browse interactive HTML reports, and search across your local documents. Runs as a local web app, without opening Obsidian. The web app never edits your originals.

![DocShelf Web displaying an HTML report with documents grouped by project](public/docshelf-overview.png)

### DocShelf for Obsidian

Bring project documents into Obsidian without copying them into your vault. Edit local Markdown in the native editor, with changes saved to the original file, with conflict checks and recovery. Browse HTML and remote documents read-only.

![DocShelf in Obsidian, showing project documents and a selected Markdown source line in the native editor](public/docshelf-obsidian.png)

## Get started

You need **Git and Node.js 24 or newer** to build either app. Clone DocShelf beside the projects you want to catalog:

```sh
mkdir -p ~/workspace
cd ~/workspace
git clone https://github.com/oliver-im/docshelf.git
cd docshelf
npm ci
```

Then follow the setup for your app.

### Set up the web app

On macOS:

```sh
npm run setup
```

Open **[https://shelf.localhost/](https://shelf.localhost/)** when setup finishes. Your first shelf includes this README. Choose a document in the sidebar or use search to find a passage. DocShelf starts automatically when you log in; setup asks before administrator access or certificate trust changes.

For a foreground server on other platforms or without automatic startup, use `npm run watch`. See the [web app setup guide](https://github.com/oliver-im/docshelf/blob/main/docs/local-server.md) for the address, first-shelf setup, and troubleshooting. The web app requires a filesystem with symbolic-link support; Windows is not yet verified.

### Install the Obsidian plugin

Requires **desktop Obsidian 1.13.7 or later**. From the repository root:

```sh
npm run package:obsidian
```

Copy `packages/obsidian/dist/docshelf/` into `<vault>/.obsidian/plugins/docshelf/` and enable **DocShelf** in Community plugins. Installation is currently manual.

Open **DocShelf: Open shelf** from the command palette and click **Create empty shelf file**. Add a document with the skill below, then select it in the sidebar. To use an existing shelf, choose it in **DocShelf: Configure shelf**. The [plugin guide](https://github.com/oliver-im/docshelf/blob/main/packages/obsidian/README.md) also includes a sample shelf, workspace settings, and editing controls.

## Add documents with your agent

Install the very lightweight `docshelf` skill to add the documents to DocShelf easily:

```sh
npx skills add oliver-im/docshelf --skill docshelf -g
```

After creating a report or note, ask your agent:

> Add this report to DocShelf.

The skill registers the original file, preserves existing shelf entries, checks the result, and returns links for your configured apps. It can also return a source-line reference for a specific passage.

To register documents manually, follow the [web app registration guide](https://github.com/oliver-im/docshelf/blob/main/docs/usage.md#register-local-documents) or [Obsidian registration guide](https://github.com/oliver-im/docshelf/blob/main/packages/obsidian/README.md#register-documents).

## Guides

- [DocShelf Web: navigation, line links, and remote imports](https://github.com/oliver-im/docshelf/blob/main/docs/usage.md)
- [Using both apps with one shelf](https://github.com/oliver-im/docshelf/blob/main/docs/unification.md)
- [Development and verification](https://github.com/oliver-im/docshelf/blob/main/docs/local-server.md#development-and-verification)
- [Releasing DocShelf](https://github.com/oliver-im/docshelf/blob/main/docs/releasing.md)
- [Security and file access](https://github.com/oliver-im/docshelf/blob/main/SECURITY.md)

## License

MIT. Themes adapt Tokyo Night for Obsidian; the optional HTML theme also includes matcha.css. See the [third-party notices](https://github.com/oliver-im/docshelf/blob/main/THIRD_PARTY_NOTICES.md).
