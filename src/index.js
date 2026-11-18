/**
 * eleventy-carve — an Eleventy (11ty) plugin that registers the Carve markup
 * language as a first-class template format.
 *
 * Carve files (`.crv`) become renderable Eleventy templates:
 *   - the body is converted to HTML by the Carve 0.2 public API,
 *   - leading Carve frontmatter (`---` / `---toml` / `---json`) is deserialized
 *     and folded into Eleventy's data cascade (so `title`, `layout`,
 *     `permalink`, `tags`, etc. behave like they do in Markdown templates).
 *
 * Usage (eleventy.config.js, ESM):
 *
 *   import carvePlugin from "@markup-carve/eleventy-carve";
 *   export default function (eleventyConfig) {
 *     eleventyConfig.addPlugin(carvePlugin, {
 *       // extensions: [ ...Carve 0.2 extension definitions ],
 *       // carveOptions: { ...Carve 0.2 render options },
 *     });
 *   }
 */

import { includeDependencies, lint, parse, parseWithDiagnostics, renderWithDiagnostics, stringOffsetOfByte } from '@markup-carve/carve/v2'
import { fileSystemResolver } from '@markup-carve/carve/v2/node'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { parseFrontmatter } from './frontmatter.js'
import yaml from 'js-yaml'
import toml from '@iarna/toml'
import { codeCollector, highlighterFor } from './highlight.js'

/** Translate the plugin's compatibility flags into 0.2 render options. */
function renderOptions(options) {
  const { asciiHeadingIds, lowercaseHeadingIds, safeMode, ...rest } = options
  if (safeMode !== undefined) {
    if (rest.rawHtml !== undefined) throw new Error('eleventy-carve: set only rawHtml')
    rest.rawHtml = !safeMode
  }
  if (asciiHeadingIds !== undefined || lowercaseHeadingIds !== undefined) {
    if (rest.headingIds !== undefined) throw new Error('eleventy-carve: set only headingIds')
    rest.headingIds = asciiHeadingIds ? (lowercaseHeadingIds ? 'ascii-lower' : 'ascii') : lowercaseHeadingIds ? 'lower' : 'keep-case'
  }
  return rest
}

function location(source, diagnostic) {
  if (!diagnostic.range) return {}
  let text = source
  if (diagnostic.file) {
    try { text = readFileSync(diagnostic.file, 'utf8') } catch { return {} }
  }
  const offset = stringOffsetOfByte(text, diagnostic.range.startOffset)
  const before = text.slice(0, offset)
  const lines = before.split(/\r\n|\r|\n/)
  return { line: lines.length, column: [...lines.at(-1)].length + 1 }
}

function reportDiagnostics(source, result, options, root, seen = new Set()) {
  for (const diagnostic of result.diagnostics) {
    const key = JSON.stringify([diagnostic.channel, diagnostic.code, diagnostic.path, diagnostic.file, diagnostic.range])
    if (seen.has(key)) continue
    seen.add(key)
    const file = diagnostic.file && root ? path.resolve(root, diagnostic.file) : diagnostic.file
    const { line, column } = location(source, { ...diagnostic, file })
    const where = line === undefined ? '' : ` (line ${line}, column ${column}${file ? ` of ${file}` : ''})`
    options.onWarning?.({ ...diagnostic, file, rule: diagnostic.code, line, column, message: `${diagnostic.message} [${diagnostic.code}]${where}` })
  }
  if (result.suppressedDiagnostics) options.onWarning?.({
    code: 'diagnostics-truncated',
    message: `${result.suppressedDiagnostics} additional diagnostics were suppressed`,
  })
}

function reportLint(source, options, extensions, includes, root, sourcePath) {
  if (!options.lint) return
  const settings = options.lint === true ? {} : options.lint
  const rules = { ...settings.rules }
  for (const name of settings.enabledRules ?? []) rules[name] = 'on'
  if (settings.captionLookingParagraph !== undefined) rules['caption-looking-paragraph'] = settings.captionLookingParagraph ? 'on' : 'off'
  const ignored = new Set(settings.ignoredFiles?.flatMap(fileIds) ?? [])
  const findings = lint(source, { rules, platforms: settings.platforms, includes, extensions })
    .filter((finding) => finding.channel === 'lint' && !ignored.has(finding.file && root ? path.resolve(root, finding.file) : sourcePath ? path.resolve(sourcePath) : undefined))
  reportDiagnostics(source, { diagnostics: findings, suppressedDiagnostics: 0 }, options, root)
}

/**
 * The engine matches file ids exactly: the template's absolute path, and the
 * real path the file resolver reports for an include.
 */
function fileIds(file) {
  const absolute = path.resolve(file)
  try {
    return [absolute, realpathSync(absolute)]
  } catch {
    return [absolute]
  }
}

/**
 * Build the function Eleventy calls to turn one Carve source string into HTML.
 * Exposed separately so it can be tested without a full Eleventy build.
 *
 * @param {object} [options]
 * @param {Array} [options.extensions] - Carve 0.2 extension definitions
 * @param {object} [options.carveOptions] - Carve 0.2 render options
 * @returns {(source: string) => string}
 */
export function createCarveRenderer(options = {}, sourcePath) {
  const carveOptions = renderOptions(options.carveOptions ?? {})
  return function renderCarve(source, data, extraExtensions = []) {
    if (options.wikilinks) throw new Error('eleventy-carve: wikilinks are not available yet in Carve 0.2')
    const extensions = [...(options.extensions ?? carveOptions.extensions ?? []), ...(Array.isArray(extraExtensions) ? extraExtensions : [])]
    const root = options.includeRoot ?? (sourcePath ? path.dirname(path.resolve(sourcePath)) : undefined)
    if (options.includeRoot && !path.isAbsolute(options.includeRoot)) throw new Error('eleventy-carve: includeRoot must be an absolute path')
    const includes = carveOptions.includes ?? (sourcePath && (options.includes ?? true)
      ? {
          resolver: fileSystemResolver(root),
          file: path.relative(root, path.resolve(sourcePath)).replaceAll(path.sep, '/'),
        }
      : undefined)
    let parsed = parseWithDiagnostics(source, { extensions, includes, headingIds: carveOptions.headingIds })
    let renderers = carveOptions.renderers
    if (extraExtensions?.forDocument) {
      const registrations = extraExtensions.forDocument(parsed.document)
      if (registrations.extensions.length) {
        extensions.push(...registrations.extensions)
        renderers = { ...renderers, ...registrations.renderers }
        parsed = parseWithDiagnostics(source, { extensions, includes, headingIds: carveOptions.headingIds })
      }
    }
    for (const dependency of includeDependencies(parsed.document)) options.onDependency?.({ id: dependency.file && root ? path.resolve(root, dependency.file) : dependency.file ?? dependency.path, resolved: dependency.read, ...dependency })
    const seen = new Set()
    reportDiagnostics(source, parsed, options, root, seen)
    reportLint(source, options, extensions, includes, root, sourcePath)
    const rendered = renderWithDiagnostics(parsed.document, { ...carveOptions, extensions, renderers })
    reportDiagnostics(source, rendered, options, root, seen)
    return rendered.html
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
  return parseFrontmatter(doc.children.find((node) => node.type === 'frontmatter'))
}

/**
 * Eleventy hands `compile` the body after gray-matter removed the frontmatter.
 * Carve must parse the whole file: otherwise a body starting with `---` is
 * read as frontmatter again, and positions shift by the frontmatter's lines.
 * Only the exact body is swapped; `compile` also receives other strings for
 * the same path, such as `eleventyComputed` values.
 */
function templateSource(inputContent, inputPath) {
  if (typeof inputContent !== 'string' || !inputPath) return inputContent
  let raw
  try {
    raw = readFileSync(inputPath, 'utf8')
  } catch {
    return inputContent
  }
  if (inputContent === raw) return raw
  const endLine = parse(raw).children.find((node) => node.type === 'frontmatter')?.pos?.endLine
  return endLine !== undefined && inputContent === afterLine(raw, endLine) ? raw : inputContent
}

function afterLine(text, line) {
  const breaks = /\r\n|\r|\n/g
  for (let n = 0; n < line; n++) if (!breaks.exec(text)) return ''
  return text.slice(breaks.lastIndex)
}

/**
 * Eleventy plugin entry point.
 *
 * @param {import("@11ty/eleventy").UserConfig} eleventyConfig
 * @param {object} [options]
 * @param {string[]} [options.templateFormats] - defaults to ["crv"]
 * @param {Array} [options.extensions] - Carve 0.2 extension definitions
 * @param {object} [options.carveOptions] - Carve 0.2 render options
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
      const source = templateSource(inputContent, inputPath)
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
      // Eleventy calls this once per output with the merged data.
      return async function (data) {
        const highlighter = await highlighterFor(options.highlight)
        if (!highlighter) return renderCarve(source, data)
        const collector = codeCollector(highlighter)
        return collector.apply(renderCarve(source, data, collector))
      }
    },
  })
}
