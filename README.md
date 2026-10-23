# eleventy-carve

An [Eleventy](https://www.11ty.dev/) (11ty) plugin that adds the
[Carve](https://markup-carve.github.io/carve/) markup language as a first-class
template format. Carve files (`.crv`) become renderable Eleventy
templates, with their bodies converted to HTML by
[carve-js](https://github.com/markup-carve/carve-js) and their frontmatter
folded into Eleventy's data cascade.

Package name: `@markup-carve/eleventy-carve`.

## Requirements

- Node.js 18+ (developed and tested on Node 22)
- Eleventy 3.x (ESM). Declared as a peer dependency (`@11ty/eleventy >=3.0.0`).

## Install

```bash
npm install @markup-carve/eleventy-carve
```

`@markup-carve/carve` (the rendering engine) comes from npm as an ordinary
dependency, so `npm install` above is all that is needed.

## Usage

`eleventy.config.js` (ESM):

```js
import carvePlugin from '@markup-carve/eleventy-carve'

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(carvePlugin)

  return {
    dir: { input: 'input', output: '_site', includes: '_includes' },
    templateFormats: ['crv'],
  }
}
```

Now any `.crv` file under your input directory is built like a
Markdown template would be.

### Example Carve page

```
---
title: Carve Home
layout: base.njk
---

# Welcome

This page is written in *Carve*.

- one
- two

See [the project](https://markup-carve.github.io/carve/).
```

## Options

`addPlugin(carvePlugin, options)` accepts:

| Option            | Type       | Default            | Description                                                                 |
| ----------------- | ---------- | ------------------ | --------------------------------------------------------------------------- |
| `templateFormats` | `string[]` | `["crv"]`          | File extensions to register as Carve templates.                             |
| `extensions`      | `array`    | `[]`               | carve-js `CarveExtension` list (e.g. citations, mermaid, details).          |
| `carveOptions`    | `object`   | `{}`               | Extra carve-js options (`ParseOptions` + `RenderOptions`), e.g. `{ lowercaseHeadingIds: true }`. |
| `includes`        | `boolean`  | `true`              | Expand `{{ path }}` directives for file-backed templates.                     |
| `includeRoot`     | `string`   | document directory | Absolute containment root for included files.                                |
| `lint`            | `boolean \| { platforms }` | `false` | Report carve-js lint findings through `onWarning`. See [Lint](#lint).         |
| `wikilinks`       | `boolean \| object` | `false`   | Parse `[[Page]]` links and resolve them against a collection. See [Wiki links](#wiki-links). |
| `onWarning`       | `function` | logs to console    | Receives include warnings, render losses, lint findings and wiki-link warnings. |

Example with options:

```js
import carvePlugin from '@markup-carve/eleventy-carve'
import { mermaid } from '@markup-carve/carve'

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(carvePlugin, {
    extensions: [mermaid()],
    carveOptions: { lowercaseHeadingIds: true },
  })
}
```

Include paths resolve relative to the template. Resolved files are added to
Eleventy's watch targets. Set `includes: false` to leave directives literal.
`{{ shared.crv @region:intro }}` splices only the lines between
`%% #region intro` and `%% #endregion`; a missing region is reported through
`onWarning` with the rule `include-region-invalid`.

## Lint

`lint: true` runs the carve-js linter on every Carve template, following its
includes. Each finding reaches `onWarning` with `code` set to the rule id, the
`line`, `column` and, for an included file, `file`, and a message such as
`Link to "#nowhere" matches no id in this document, so the link goes nowhere. [broken-fragment-link] (line 5, column 7)`.
Without an `onWarning` hook the plugin logs it to the console. Lint never fails
the build. `lint: { platforms: ['github'] }` adds the rules for text GitHub
re-links, such as a bare `#12`.

## Wiki links

`wikilinks` enables the carve-js `[[Page]]` syntax (`[[Page|label]]`,
`[[Page#anchor]]`, `[[folder/page]]`) and links each target to the URL of a page
in an Eleventy collection:

```js
eleventyConfig.addPlugin(carvePlugin, {
  wikilinks: {
    collection: 'all', // default
    // Optional, tried first. Return undefined to fall through to the collection.
    resolve: (page, data) => (page === 'Changelog' ? '/changelog/' : undefined),
    cssClass: 'wikilink',
    newWindow: false,
  },
})
```

A name is compared as a slug against, in order, the page's path stem without
the input directory prefix (`[[docs/getting-started]]`), its file slug
(`[[Getting Started]]` finds `getting-started.crv`), and its `title`. The link
goes to the page's `url`, so permalinks are honored. Pages with
`permalink: false` are skipped. A name that matches nothing or several pages
reaches `onWarning` (`wikilink-unresolved`, `wikilink-ambiguous`) and links to
the plain slug. `wikilinks: true` uses the defaults.

## Frontmatter

Carve frontmatter is a fenced metadata block at the top of the file. All three
Carve frontmatter flavors are supported and flow into Eleventy's data cascade
(so `title`, `layout`, `permalink`, `tags`, `date`, etc. behave exactly as in a
Markdown template):

YAML (bare fence, the default):

```
---
title: Hello
layout: base.njk
tags: [post]
---
```

TOML (`---toml` token):

```
---toml
title = "Hello"
permalink = "/custom-url/index.html"
---
```

JSON (`---json` token):

```
---json
{ "title": "Hello", "draft": true }
---
```

The plugin uses carve-js's own parser to locate the frontmatter block (so the
syntax stays in lockstep with the engine) and then deserializes it with
`js-yaml` / `@iarna/toml` / `JSON.parse`.

> [!NOTE]
> The plugin registers matching gray-matter engines via
> `setFrontMatterParsingOptions` so Eleventy's built-in frontmatter pass does
> not reject the `---toml` / `---json` tokens. This is a global Eleventy setting;
> if your project already uses custom frontmatter engines, merge them rather than
> letting the plugin overwrite yours.

## Public API

The module also exports helpers (useful for testing or custom pipelines):

```js
import carvePlugin, {
  createCarveRenderer, // (options?, sourcePath?) => (source, data?) => html
  extractFrontmatter,  // (source) => dataObject
} from '@markup-carve/eleventy-carve'
```

## What is verified

This plugin ships with tests that run for real:

- A unit test of the compile function (heading, bold, list, link, frontmatter
  stripping, option forwarding) and of frontmatter extraction (YAML / TOML /
  JSON).
- A full Eleventy build of `example/` that asserts the converted Carve HTML
  appears in `_site/`, that the YAML `title` reached the layout, and that the
  TOML `permalink` was honored.

Run them with `npm test`.
