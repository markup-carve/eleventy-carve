# Changelog

Notable changes to `eleventy-carve`.

Rendering is done by the Carve engine (`@markup-carve/carve`), so an engine
change can alter output with no plugin diff. Engine bumps therefore get an
entry of their own.

## 0.1.1 - 2026-09-21

### Added

- `{{ path }}` include directives in file-backed templates now expand,
  resolved relative to the template and contained to its directory by default.
  Included files join Eleventy's watch targets. `includes: false` leaves them
  literal, and `includeRoot` sets an absolute containment root (#16).

### Changed

- Requires `@markup-carve/carve` 0.1.7 (`^0.1.7`), the first release carrying
  contained include expansion (#18).

## 0.1.0 - 2026-08-18

First release.

### Added

- Eleventy (11ty) plugin adding Carve as a first-class template format. `.crv`
  files become renderable Eleventy templates: bodies are converted to HTML by
  carve-js, frontmatter folds into Eleventy's data cascade.
- Eleventy 3.x (ESM) is accepted as a peer dependency (`>=3.0.0`).
- `exports` names `./package.json`, so
  `require('@markup-carve/eleventy-carve/package.json')` reads the installed
  version back (markup-carve/carve#1484).

### Security

- Requires the Carve engine `@markup-carve/carve` >= 0.1.4 (`^0.1.4`). 0.1.4 is a
  security release: a list-valued URL attribute was only probed on its first
  entry, so `srcset="safe.png 1x, javascript:alert(1) 2x"` passed sanitization
  on the second one. Nothing published from this repo ever carried the older
  engine, so this is a floor rather than a fix for an installed version.
