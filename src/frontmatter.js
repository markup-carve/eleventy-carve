/**
 * Frontmatter extraction for Carve source.
 *
 * Carve frontmatter is a fenced metadata block at the very top of a document:
 *
 *   ---            (bare: default format, yaml)
 *   title: Hello
 *   ---
 *
 *   ---toml        (explicit format token: toml | json | yaml)
 *   title = "Hello"
 *   ---
 *
 *   ---json
 *   { "title": "Hello" }
 *   ---
 *
 * carve-js (parse()) already recognizes the fence and exposes the raw block as
 * `doc.frontmatter = { format, content }` without interpreting `content`. We
 * use carve-js to locate/strip the block (so the syntax stays in lockstep with
 * the engine), then deserialize `content` here into a plain data object that
 * Eleventy folds into its data cascade.
 *
 * Supported formats: yaml (default for bare `---`), toml, json.
 */

import yaml from 'js-yaml'
import toml from '@iarna/toml'

/**
 * Deserialize a raw Carve frontmatter block into a plain object.
 *
 * @param {{ format: string, content: string }} fm - raw block from carve-js
 * @returns {Record<string, unknown>}
 */
export function parseFrontmatter(fm) {
  if (!fm || typeof fm.content !== 'string') {
    return {}
  }
  const format = (fm.format || 'yaml').toLowerCase()
  const content = fm.content

  let data
  switch (format) {
    case 'json':
      data = content.trim() === '' ? {} : JSON.parse(content)
      break
    case 'toml':
      data = toml.parse(content)
      break
    case 'yaml':
    case 'yml':
    case '':
      data = yaml.load(content)
      break
    default:
      throw new Error(
        `eleventy-carve: unsupported Carve frontmatter format "${fm.format}" ` +
          `(supported: yaml, toml, json)`,
      )
  }

  if (data === null || data === undefined) {
    return {}
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      `eleventy-carve: Carve frontmatter must deserialize to an object, ` +
        `got ${Array.isArray(data) ? 'array' : typeof data}`,
    )
  }
  return data
}
