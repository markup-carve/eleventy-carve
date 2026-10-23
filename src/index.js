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

import { carveToHtmlWithReport, expandIncludes, lintCarve, parse, renderDocumentWithReport, resolve } from '@markup-carve/carve'
import { fileSystemResolver } from '@markup-carve/carve/node'
import path from 'node:path'
import { parseFrontmatter } from './frontmatter.js'
import yaml from 'js-yaml'
import toml from '@iarna/toml'
import { wikilinksExtension } from './wikilinks.js'
import { codeCollector, highlighterFor } from './highlight.js'

/**
 * Build the function Eleventy calls to turn one Carve source string into HTML.
 * Exposed separately so it can be unit tested without a full Eleventy build.
 *
 * @param {object} [options]
 * @param {Array} [options.extensions] - carve-js CarveExtension list
 * @param {object} [options.carveOptions] - extra carve-js ParseOptions/RenderOptions
 * @returns {(source: string) => string}
 */
/**
 * A render loss is the engine saying it dropped something the author wrote: a
 * blanked `javascript:` destination, a flattened ruby annotation, a raw block
 * for another format. It goes out through the same hook the include warnings
 * use, so a caller that already handles those needs no change.
 *
 * @param {{ value: string, losses: Array<object>, totalLosses: number, truncated: boolean }} result
 * @param {object} options
 * @returns {string}
 */
function reportLosses(result, options) {
  for (const loss of result.losses) {
    const at = loss.pos ? ` (line ${loss.pos.startLine}, column ${loss.pos.startColumn})` : ''
    options.onWarning?.({ ...loss, message: `${loss.message} [${loss.code}]${at}` })
  }
  if (result.truncated) {
    options.onWarning?.({
      code: 'render-losses-truncated',
      message: `${result.totalLosses} render losses in total; the rest were not reported`,
    })
  }
  return result.value
}

/**
 * Lint findings go out through `onWarning` like include warnings, with the
 * rule id as `code` and the position in the message.
 */
function reportLint(source, options, extensions, includeOptions) {
  if (!options.lint) return
  const { carveOptions = {} } = options
  const findings = lintCarve(source, {
    includes: includeOptions,
    asciiHeadingIds: carveOptions.asciiHeadingIds,
    lowercaseHeadingIds: carveOptions.lowercaseHeadingIds,
    extensions,
    platforms: options.lint === true ? undefined : options.lint.platforms,
  })
  for (const finding of findings) {
    const where = `line ${finding.line}, column ${finding.column}${finding.file ? ` of ${finding.file}` : ''}`
    options.onWarning?.({ ...finding, code: finding.rule, message: `${finding.message} [${finding.rule}] (${where})` })
  }
}

export function createCarveRenderer(options = {}, sourcePath) {
  const { carveOptions = {} } = options
  return function renderCarve(source, data, extraExtensions = []) {
    const wiki = options.wikilinks
      ? [wikilinksExtension(options.wikilinks === true ? {} : options.wikilinks, data, (warning) => options.onWarning?.(warning))]
      : []
    const extensions = [...(options.extensions ?? []), ...wiki, ...extraExtensions]
    const includeOptions = sourcePath && (options.includes ?? true)
      ? {
          // A configured root reaches the resolver unchanged, so its absolute-path
          // refusal (PART 9 section 19, I10) still fires. Resolving it here would
          // root containment at the process working directory instead. Eleventy's
          // own inputPath is relative to that directory, so the default still resolves.
          resolve: fileSystemResolver(options.includeRoot ?? path.dirname(path.resolve(sourcePath))),
          sourcePath: path.resolve(sourcePath),
        }
      : undefined
    if (includeOptions) {
      const expanded = expandIncludes(parse(source, { ...carveOptions, extensions }), source, { ...includeOptions, extensions })
      for (const dependency of expanded.dependencies) options.onDependency?.(dependency)
      for (const warning of expanded.warnings) options.onWarning?.(warning)
      reportLint(source, options, extensions, includeOptions)
      const { asciiHeadingIds, lowercaseHeadingIds } = carveOptions
      return reportLosses(renderDocumentWithReport(resolve(expanded.doc, { asciiHeadingIds, lowercaseHeadingIds }), { ...carveOptions, extensions }), options)
    }
    reportLint(source, options, extensions, undefined)
    return reportLosses(carveToHtmlWithReport(source, { ...carveOptions, extensions }), options)
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
      // Eleventy calls this once per output with the merged data; wiki links
      // read `data.collections` from it.
      return async function (data) {
        const highlighter = await highlighterFor(options.highlight)
        if (!highlighter) return renderCarve(inputContent, data)
        const collector = codeCollector(highlighter)
        return collector.apply(renderCarve(inputContent, data, [collector.extension]))
      }
    },
  })
}
