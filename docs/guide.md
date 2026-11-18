# eleventy-carve 0.2 guide

The plugin registers `.crv` files as Eleventy templates. It renders them with the public Carve 0.2 library entry and places YAML, TOML, or JSON frontmatter in Eleventy's data cascade. This branch pins a commit of the unreleased JavaScript engine and requires Node.js 20 or newer.

## Setup

```js
import carvePlugin from '@markup-carve/eleventy-carve'

export default function (config) {
  config.addPlugin(carvePlugin, {
    lint: { rules: { 'non-descriptive-link-text': 'on' } },
  })
}
```

A page can use Carve 0.2 syntax:

```crv
---
title: Home
layout: base.njk
---

= Welcome

This is *Carve*.

- one
- two

See [the project](https://markup-carve.github.io/carve/).
```

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `templateFormats` | `['crv']` | File extensions registered as Carve templates. |
| `extensions` | `[]` | Carve 0.2 `ExtensionDefinition` registrations. |
| `carveOptions` | `{}` | Carve 0.2 render options, including `renderers`, `headingIds`, `rawHtml`, and `urlPolicy`. |
| `includes` | `true` | Expand includes in file-backed templates. |
| `includeRoot` | template directory | Absolute containment root for included files. |
| `lint` | `false` | Send 0.2 lint diagnostics to `onWarning`; use `rules` and `platforms` to configure it. |
| `highlight` | `false` | Highlight supported fenced code with Shiki. |
| `wikilinks` | `false` | Reserved for the 0.2 wiki parser hook; enabling it currently throws a clear error. |
| `onWarning` | console | Receive parse, lint, and render diagnostics. |
| `onDependency` | none | Receive included files for a custom watch integration. |

The engine's `headingIds` choices include `off`, `keep-case`, `lower`, `ascii`, and `ascii-lower`. The old `asciiHeadingIds` and `lowercaseHeadingIds` booleans still map to those values, but `headingIds` is preferred. Set only one form. The old `safeMode` boolean maps to the inverse of `rawHtml`; `rawHtml` and `urlPolicy` are the 0.2 controls. The default keeps raw HTML off and denies unsafe URL schemes.

Pass 0.2 extension definitions through `extensions` and trusted renderer functions through `carveOptions.renderers`. The 0.1 `CarveExtension` objects and helper factories are not accepted by the 0.2 entry. For example, the engine's standard tabs registration is:

```js
import { tabsExtensions, tabsRenderer } from '@markup-carve/carve/v2'

config.addPlugin(carvePlugin, {
  extensions: tabsExtensions,
  carveOptions: { renderers: { 'carve.tabs': tabsRenderer } },
})
```

The 0.2 extension contract is provisional. Trusted renderers must apply the host's URL policy when they create links.

## Includes and watch targets

`{{ chapter.crv }}` resolves relative to the template. The default containment root is the template directory. Set an absolute `includeRoot` to share files across directories. A successfully read include is added to Eleventy's watch targets. `includes: false` leaves the directive unexpanded. A custom 0.2 include resolver can be passed as `carveOptions.includes`; the engine controls its depth and byte limits.

Parse and include diagnostics reach `onWarning`. Each warning has `code`, lowercase `severity`, `channel`, `message`, and, when available, `line`, `column`, and `file`. Render losses use `channel: 'render-loss'`. The callback does not fail the build by itself.

## Lint

Set `lint: true` for default rules or pass an object:

```js
config.addPlugin(carvePlugin, {
  lint: {
    rules: { 'non-descriptive-link-text': 'on' },
    platforms: ['github'],
    ignoredFiles: ['src/legacy/page.crv'],
  },
})
```

The `rules` map uses `on` and `off`. The old `enabledRules` list and `captionLookingParagraph` boolean are translated for compatibility; `ignoredFiles` is filtered by this plugin. Suppression comments in the source still work. Lint uses the 0.2 diagnostic codes and lowercase severity values.

## Syntax highlighting

Install the optional Shiki and Carve grammar peer dependencies, then set `highlight: true` or pass Shiki options such as `theme`, `themes`, `langs`, `langAlias`, and `transformers`. The plugin registers a provisional 0.2 fence extension for each supported language in the template and renders its HTML with Shiki. Fences without a language or a supported grammar keep the engine's plain code block. Fence IDs, classes, attributes, and titles are carried to the highlighted element.

```js
config.addPlugin(carvePlugin, {
  highlight: { themes: { light: 'github-light', dark: 'github-dark' } },
})
```

Load the Carve grammar stylesheet in your layout when highlighting Carve fences.

## Wiki links pending in the engine

The 0.1 `wikilinks` option resolved `[[Page]]`, `[[Page|label]]`, and folder targets against Eleventy collections. The 0.2 parser currently reads those spellings as text. The public extension matcher cannot claim them, so enabling `wikilinks` throws `wikilinks are not available yet in Carve 0.2`. The option remains in the plugin, and [the engine parser hook request](https://github.com/markup-carve/carve-js/issues/5047) tracks the gap. Use ordinary Carve links until it lands.

## Frontmatter

A leading `---` block is YAML; `---toml` and `---json` select the other formats. The plugin reads the 0.2 `frontmatter` tree child and deserializes its `value` for Eleventy. It also registers matching gray-matter engines so Eleventy's own frontmatter pass does not reject an explicit format token.

```crv
---toml
title = "About"
permalink = "/about-us/index.html"
---

= About
```

## Public helpers

```js
import carvePlugin, { createCarveRenderer, extractFrontmatter } from '@markup-carve/eleventy-carve'

const html = createCarveRenderer()('= Hello\n')
const data = extractFrontmatter('---\ntitle: Hello\n---\n')
```
