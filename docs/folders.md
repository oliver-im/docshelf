# Add files and folders

Use **Add…** to register files, folders, or a mixture. In Obsidian, the shelf’s top-level **+**, **DocShelf: Add…** command, or background right-click first asks for a project. Choose an existing project or type a name to create one, then choose files and folders. Right-clicking a project heading or document uses that project directly. On the local web app, use the existing **+** button or right-click Add; its form lets you set the project.

On macOS, the combined file/folder picker shows the destination project in its title. Select your files or folders and click **Add** in the picker; they are added immediately, with no confirmation window afterward. Document titles are inferred. Cancelling either chooser leaves the shelf alone and does not create an empty project; selecting something already registered does not duplicate or move it. Other desktop platforms accept paths in a form followed by **Add**. The web app accepts one local path per line followed by **Preview → Add**. Paths may be absolute or relative to the shelf file and are saved as relative paths. An empty folder is still registered and watched. A missing shelf file is created locally; Add never changes the tracked empty template.

Local web additions require the loopback watcher (`npm run watch`). They update its local shelf, so Obsidian sees them when it uses that same shelf. Static hosting continues to offer public-document imports in browser storage; it cannot register local paths. Restart a running watcher after updating the app code to enable the new endpoint.

Right-click a document and choose **Remove from shelf…**, then confirm with **Remove** or choose **Cancel**. This changes the shelf only; original files and remote documents stay untouched. A document from a watched folder is excluded by its exact path from every overlapping registered folder so it does not reappear. Other documents with the same filename stay on the shelf. The local web watcher supports the same action; browser imports can also be removed individually from that browser.

You can restore a removed local document by adding that file explicitly. Open unsaved Obsidian drafts are kept, with saving blocked until the source is registered again. Re-adding the same source path reconnects its open drafts even if its shelf link changes. Reopening the document can also recover a closed draft, which requires review before saving. External changes still require conflict resolution.

In Obsidian, right-click a project heading and choose **Reset to alphabetical** to reset its document order. **Reset project order** resets the order of project headings. Both actions leave shelf registrations unchanged.

## Recursive discovery

Folders include `.md`, `.markdown`, `.html`, and `.htm` documents recursively, including subfolders created later. Markdown headings and HTML page titles provide names, with filenames as a fallback. Existing individual registrations take precedence, preserving their title, route, project, description, and asset list. Originals stay in their projects.

Hidden descendants and folders named `node_modules`, `dist`, `build`, `coverage`, or `vendor` are skipped. Selecting a hidden folder such as `.local` directly is allowed within the configured workspace. Descendant symlinks are skipped, avoiding cycles and traversal into unrelated trees. Every discovered source must remain inside the selected folder and the existing workspace boundary.

New documents appear automatically, edits update open views and search, and deleted documents leave the catalog. A rename is a removal followed by a new path; path-derived links can change. Generated routes stay stable when titles or contents change. Overlapping folders are deduplicated by canonical source, with folder IDs determining precedence in alphabetical order. Explicit individual entries always win.

Removing a folder registration or source file keeps an open unsaved Obsidian draft and blocks saving it back. Web updates use the existing full build and browser revision checks, which run every three seconds in visible tabs. A catalog change reloads the page after a successful build; content changes refresh the affected document.

## Shelf format

Version 1 shelves remain supported. Adding the first folder upgrades the local shelf to version 2; older app versions reject it rather than silently omitting folder contents. Update both apps before adding folders to a shared shelf.

```json
{
  "version": 2,
  "directories": [
    {
      "id": "project-docs",
      "source": "../my-project/docs",
      "project": "My project",
      "recursive": true,
      "exclude": ["drafts", "reviews/archive"]
    }
  ],
  "artifacts": []
}
```

Folder IDs are unique lowercase letters, numbers, and hyphens. Keep IDs stable because generated routes use them. `recursive` defaults to `true`; set it to `false` for immediate files only. `exclude` contains relative file or folder paths: a single name matches at any depth, while a multi-part path matches from the selected root. Entries beginning with `./` match one exact file path from that root, treating punctuation literally; the Remove action creates these entries. Wildcards and traversal are unsupported. Each folder supports up to 2,000 exclusions. To remove a folder, remove its entry from `directories`; this does not delete source files.

Discovery is bounded to 100 registered folders, 2,000 documents, 20,000 examined entries, and 32 levels of nesting. Choose narrower folders or exclusions if a scan exceeds these limits. Discovered documents over 8 MB are skipped with a warning. Missing folders remain registered so they can recover when restored.

Folder registration adds documents, not an unrestricted asset directory. HTML isolation and each app’s asset policy remain in place. For Obsidian images or report assets, use an individual registration with an explicit `assets` list as an override. The web Add API requires loopback access, a same-origin request, and the current session token; it has no source-file write operation.
