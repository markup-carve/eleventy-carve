# Changelog

Notable changes to `eleventy-carve`.

Rendering is done by the Carve engine (`@markup-carve/carve`), so an engine
change can alter output with no plugin diff. Engine bumps therefore get an
entry of their own.

## [0.1.2] - 2026-10-08

### Added

- A render loss the engine records goes out through `onWarning`, the hook the
  include warnings already use, carrying its code and source position. Rendering
  went through `renderDocument` and `carveToHtml`, which return a string and
  drop the report, so a blanked `javascript:` destination, a flattened ruby
  annotation or a raw block for another format left no trace. The plugin's
  default hook logs to the Eleventy console, so a caller that set none sees them
  too (#24).

### Changed

- Tested against `@markup-carve/carve` 0.1.10. The declared range `^0.1.7`
  already resolved it, but the committed lockfile held 0.1.7, so CI had never
  run the engine a consumer installs. Three engine behaviors this renderer
  reaches now have tests: a case-only cross-reference stays literal, an include
  renames every colliding id rather than only a heading id, and a denied
  destination scheme is reported (#24).

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
