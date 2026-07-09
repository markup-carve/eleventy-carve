# eleventy-carve

An [Eleventy](https://www.11ty.dev/) (11ty) plugin that adds the
[Carve](https://markup-carve.github.io/carve/) markup language as a first-class
template format. Carve files (`.crv`) become renderable Eleventy
templates, with their bodies converted to HTML by
[carve-js](https://github.com/markup-carve/carve-js) and their frontmatter
folded into Eleventy's data cascade.

Package name: `@markup-carve/eleventy`.

## Requirements

- Node.js 18+ (developed and tested on Node 22)
- Eleventy 3.x (ESM). Declared as a peer dependency (`@11ty/eleventy >=3.0.0`).

## Install

```bash
npm install @markup-carve/carve-components
```

`@markup-carve/carve` (the rendering engine) is currently vendored with this
plugin as a packed tarball (pre-release; it is not published to npm yet) and
is installed automatically from there.

## Usage

`eleventy.config.js` (ESM):

```js
import carvePlugin from '@markup-carve/carve-components'

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

Example with options:

```js
import carvePlugin from '@markup-carve/carve-components'
import { mermaid } from '@markup-carve/carve'

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(carvePlugin, {
    extensions: [mermaid()],
    carveOptions: { lowercaseHeadingIds: true },
  })
}
```

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
  createCarveRenderer, // (options?) => (source) => html
  extractFrontmatter,  // (source) => dataObject
} from '@markup-carve/carve-components'
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

## License

MIT
