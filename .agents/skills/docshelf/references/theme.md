# DocShelf HTML theme

Use this optional theme only when the user explicitly asks for the “DocShelf theme”
or clearly requests DocShelf-styled HTML. It is an authoring aid, not a style that
DocShelf injects into existing artifacts.

## Create the document

- Produce a valid, standalone HTML document with a doctype, language, charset,
  viewport, title, description, and `<meta name="color-scheme" content="light dark">`.
- Add `<meta name="docshelf-theme" content="1">` so the theme version is discoverable.
- Embed the complete contents of `../assets/docshelf-theme.css` in a
  `<style data-docshelf-theme="1">` element. Do not link to DocShelf or a CDN; the
  result must remain styled when opened by itself.
- Embed `../assets/theme-sync.js` in the document head after the theme styles. It
  follows DocShelf's selected theme when framed and the system preference when
  standalone.
- Prefer semantic HTML. Matcha supplies the broad native-element baseline; add only
  the structure and behavior the artifact actually needs.

## Extend the theme

Use the `--ds-*` custom properties from `docshelf-theme.css` for bespoke CSS and
visualizations. They cover document surfaces, text, borders, semantic states, and
an eight-color chart sequence.

- For HTML and SVG, reference the properties directly with `var(--ds-...)` and use
  `currentColor` where practical.
- For canvas or JavaScript-rendered charts, read values with
  `getComputedStyle(document.documentElement).getPropertyValue(name).trim()`.
- Render once from the current properties, then listen for
  `docshelf:themechange` on `window` and update or redraw the visualization.
- Keep library-specific chart configuration in the artifact. The theme provides
  stable tokens rather than adapters for every visualization library.

The theme is a foundation, not a restriction. Add artifact-specific styles when
they communicate the content more clearly, but derive shared colors and surfaces
from the DocShelf properties so light and dark modes remain coherent.
