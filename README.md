# eleventy-carve

Eleventy plugin for Carve 0.2 `.crv` templates. It uses the unreleased Carve JavaScript engine through a commit pin on this repository's `main` branch. Carve frontmatter joins the Eleventy data cascade, file includes become watch targets, and fenced code can be highlighted with Shiki.

This branch is for testing the Carve 0.2 port. It has no registry release.

## Install from the branch

```sh
npm install github:markup-carve/eleventy-carve
```

The git dependency builds the pinned Carve engine during installation. Node.js 20 or newer and Git are required.

## Use

```js
import carvePlugin from '@markup-carve/eleventy-carve'

export default function (config) {
  config.addPlugin(carvePlugin)
}
```

See the [guide](docs/guide.md) for options, includes, lint, extensions, highlighting, and wiki links. The [Carve 0.2 specification](https://github.com/markup-carve/carve/tree/main/spec/0.2) describes the language.

## License

[MIT](LICENSE)
