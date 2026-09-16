/**
 * eleventy-carve — an Eleventy (11ty) plugin that registers the Carve markup
 * language as a first-class template format.
 *
 * Carve files (`.crv`) become renderable Eleventy templates:
 *   - the body is converted to HTML by carve-js (`carveToHtml`),
 *   - leading Carve frontmatter (`---` / `---toml` / `---json`) is deserialized
 *     and folded into Eleventy's data cascade (so `title`, `layout`,
 *     `permalink`, `tags`, etc. behave like they do in Markdown templates).
 *
 * Usage (eleventy.config.js, ESM):
 *
 *   import carvePlugin from "@markup-carve/eleventy";
 *   export default function (eleventyConfig) {
 *     eleventyConfig.addPlugin(carvePlugin, {
 *       // extensions: [ ...carve-js extensions ],
 *       // carveOptions: { ...other carve-js ParseOptions / RenderOptions },
 *     });
 *   }
 */

import { carveToHtml, expandIncludes, parse, renderDocument, resolve } from '@markup-carve/carve'
import { fileSystemResolver } from '@markup-carve/carve/node'
import path from 'node:path'
import { parseFrontmatter } from './frontmatter.js'
import yaml from 'js-yaml'
import toml from '@iarna/toml'

/**
 * Build the function Eleventy calls to turn one Carve source string into HTML.
 * Exposed separately so it can be unit tested without a full Eleventy build.
 *
 * @param {object} [options]
 * @param {Array} [options.extensions] - carve-js CarveExtension list
 * @param {object} [options.carveOptions] - extra carve-js ParseOptions/RenderOptions
 * @returns {(source: string) => string}
 */
export function createCarveRenderer(options = {}, sourcePath) {
  const { extensions = [], carveOptions = {} } = options
  return function renderCarve(source) {
    if (sourcePath && (options.includes ?? true)) {
      // A configured root reaches the resolver unchanged, so its absolute-path
      // refusal (PART 9 section 19, I10) still fires. Resolving it here would
      // root containment at the process working directory instead. Eleventy's
      // own inputPath is relative to that directory, so the default still resolves.
      const root = options.includeRoot ?? path.dirname(path.resolve(sourcePath))
      const expanded = expandIncludes(parse(source, { ...carveOptions, extensions }), source, {
        resolve: fileSystemResolver(root),
        sourcePath: path.resolve(sourcePath),
        extensions,
      })
      for (const dependency of expanded.dependencies) options.onDependency?.(dependency)
      for (const warning of expanded.warnings) options.onWarning?.(warning)
      return renderDocument(resolve(expanded.doc), carveOptions)
    }
    return carveToHtml(source, { ...carveOptions, extensions })
  }
}

/**
 * Extract and deserialize the leading Carve frontmatter block from a source
 * string. Returns `{}` when there is none. Uses carve-js's parser to locate the
 * block so frontmatter syntax stays in lockstep with the engine.
 *
 * @param {string} source
 * @returns {Record<string, unknown>}
 */
export function extractFrontmatter(source) {
  const doc = parse(source)
  return parseFrontmatter(doc.frontmatter)
}

/**
 * Eleventy plugin entry point.
 *
 * @param {import("@11ty/eleventy").UserConfig} eleventyConfig
 * @param {object} [options]
 * @param {string[]} [options.templateFormats] - defaults to ["crv"]
 * @param {Array} [options.extensions] - carve-js extension list
 * @param {object} [options.carveOptions] - extra carve-js options
 */
export default function carvePlugin(eleventyConfig, options = {}) {
  const formats = options.templateFormats ?? ['crv']

  // Eleventy still runs gray-matter over the raw file before our extension's
  // compile step ever sees it. Carve's frontmatter syntax allows explicit
  // format tokens (`---toml`, `---json`) that gray-matter would otherwise
  // reject ("engine X is not registered"). Register matching engines so
  // gray-matter can deserialize (and, importantly, NOT throw) on every Carve
  // frontmatter flavor. Our own `getData` hook below is what actually feeds the
  // data cascade — keeping Carve the single source of truth — but gray-matter
  // must succeed first or Eleventy aborts the build.
  eleventyConfig.setFrontMatterParsingOptions({
    engines: {
      toml: (input) => toml.parse(input),
      json: (input) => (input.trim() === '' ? {} : JSON.parse(input)),
      yaml: (input) => yaml.load(input),
    },
  })

  eleventyConfig.addTemplateFormats(formats)

  eleventyConfig.addExtension(formats, {
    // Carve handles its own frontmatter fence; tell Eleventy not to also run
    // gray-matter over the file (its `---` parser would otherwise fight ours).
    read: true,

    // Pull Carve frontmatter into the data cascade. Eleventy merges whatever
    // object this returns with directory data, layout data, etc. `title`,
    // `layout`, `permalink`, `tags`, `date`, … all flow through here.
    getData: async function (inputPath) {
      const fs = await import('node:fs/promises')
      const source = await fs.readFile(inputPath, 'utf8')
      return extractFrontmatter(source)
    },

    compile: function (inputContent, inputPath) {
      const renderCarve = createCarveRenderer({
        ...options,
        onDependency(dependency) {
          if (dependency.resolved) eleventyConfig.addWatchTarget(dependency.id)
          options.onDependency?.(dependency)
        },
        onWarning(warning) {
          if (options.onWarning) options.onWarning(warning)
          else console.warn(`eleventy-carve: ${warning.message}`)
        },
      }, inputPath)
      // Returning a function makes this a permalink-aware template: Eleventy
      // calls it once per output with the merged data, but Carve rendering does
      // not depend on data, so we ignore the argument and render the source.
      return async function (/* data */) {
        return renderCarve(inputContent)
      }
    },
  })
}
