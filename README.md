# eleventy-carve

Eleventy plugin for `.crv` templates, using @markup-carve/carve 0.1.14 or later. Carve frontmatter joins the Eleventy data cascade. Read the [Carve documentation](https://markup-carve.github.io/carve/) for the language syntax.

## Install

```sh
npm install @markup-carve/eleventy-carve
```

## Usage

```js
import carvePlugin from '@markup-carve/eleventy-carve'

export default function (config) {
  config.addPlugin(carvePlugin)
}
```

## Documentation

- [Carve documentation](https://markup-carve.github.io/carve/)
- [Documentation index](docs/README.md)

## License

[MIT](LICENSE)
