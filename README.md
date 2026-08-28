# Atlas

A local, searchable catalog for explicitly registered HTML artifacts. Source
projects keep ownership of their files; Atlas provides navigation, stable local
URLs, and search without exposing the surrounding workspace.

## Setup

```sh
npm install
cp artifacts.json artifacts.local.json
npm run dev
```

Register artifacts in the ignored `artifacts.local.json` file:

```json
{
  "version": 1,
  "artifacts": [
    {
      "project": "Example Project",
      "source": "../example-project/docs/overview.html",
      "route": "example-project/overview.html",
      "title": "Project overview",
      "description": "A visual overview of the example project."
    }
  ]
}
```

Sources are relative to the Atlas directory. Routes are served below
`/artifacts/`. If no local manifest exists, Atlas uses the tracked, empty
`artifacts.json` default.

`npm run sync`, `dev`, `check`, and `build` validate the manifest and regenerate
the ignored file-level symlink tree in `public/artifacts/`.

## Production verification

```sh
npm run check
npm run build
npm run preview
```

Search is generated during the production build and is unavailable in the Astro
development server.

## License

MIT
