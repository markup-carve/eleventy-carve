// Shiki's default theme when none is configured.
const DEFAULT_THEME = 'github-dark'

async function load(specifier) {
  try {
    return await import(specifier)
  } catch (error) {
    throw new Error(`eleventy-carve: highlight needs ${specifier}; install shiki and @markup-carve/carve-grammars`, { cause: error })
  }
}

/**
 * Build a Shiki highlighter with the Carve grammar and theme extras from
 * carve-grammars. Grammars other than Carve load on first use.
 *
 * @param {object} [options] theme, themes, defaultColor, langs, langAlias, transformers
 */
export async function createCarveHighlighter(options = {}) {
  const shiki = await load('shiki')
  const grammars = await load('@markup-carve/carve-grammars/shiki')
  const resolveTheme = async (theme) => {
    const base = typeof theme === 'string' ? (await shiki.bundledThemes[theme]()).default : theme
    return grammars.extendTheme(base, base.type === 'light' ? grammars.carveLightExtras : grammars.carveDarkExtras)
  }
  const themes = options.themes && Object.keys(options.themes).length > 0
    ? Object.fromEntries(await Promise.all(Object.entries(options.themes).map(async ([key, t]) => [key, await resolveTheme(t)])))
    : undefined
  const theme = themes ? undefined : await resolveTheme(options.theme ?? DEFAULT_THEME)
  const highlighter = await shiki.createHighlighter({
    themes: themes ? Object.values(themes) : [theme],
    langs: [grammars.carveGrammar, ...(options.langs ?? [])],
    langAlias: options.langAlias,
  })
  const carveNames = new Set([grammars.carveGrammar.name, ...(grammars.carveGrammar.aliases ?? [])])
  const resolveLang = (lang) => options.langAlias?.[lang] ?? lang
  const loaded = (lang) => highlighter.getLoadedLanguages().includes(lang)

  return {
    accepts(lang) {
      const name = resolveLang(lang)
      return loaded(name) || name in shiki.bundledLanguages
    },
    async highlight(block) {
      const lang = resolveLang(block.lang)
      if (!loaded(lang)) await highlighter.loadLanguage(lang)
      const attrs = block.attrs
      const preAttributes = {
        name: 'eleventy-carve:attributes',
        pre(node) {
          if (attrs?.id) node.properties.id = attrs.id
          for (const c of attrs?.classes ?? []) this.addClassToHast(node, c)
          for (const [key, value] of Object.entries(attrs?.keyValues ?? {})) node.properties[key] = value
          if (block.header !== undefined) node.properties.title = block.header
          node.properties.dataLanguage = block.lang
        },
      }
      return highlighter.codeToHtml(block.code.replace(/\n$/, ''), {
        lang,
        ...(themes ? { themes, defaultColor: options.defaultColor } : { theme: theme.name }),
        transformers: [
          // Scope explanations are costly, so only Carve fences pay for them.
          ...(carveNames.has(lang) ? [grammars.carveStylingTransformer] : []),
          ...(options.transformers ?? []),
          preAttributes,
        ],
      })
    },
  }
}

const cache = new WeakMap()

/** One highlighter per options object, or none when highlighting is off. */
export function highlighterFor(option) {
  if (!option) return undefined
  const config = option === true ? {} : option
  let highlighter = cache.get(config)
  if (!highlighter) cache.set(config, highlighter = createCarveHighlighter(config))
  return highlighter
}

/**
 * Collects fenced code during the synchronous Carve render and leaves a
 * placeholder for the async Shiki pass. Fences without a language, or in one
 * Shiki cannot load, keep the engine's plain `<pre><code>`.
 */
export function codeCollector(highlighter) {
  const blocks = []
  const nonce = Math.random().toString(36).slice(2)
  const marker = (i) => `<!--eleventy-carve-shiki:${nonce}:${i}-->`
  return {
    extension: {
      name: 'eleventy-carve:shiki',
      blockRenderers: {
        code_block(node, ctx) {
          if (!node.lang || !highlighter.accepts(node.lang)) return undefined
          blocks.push({ lang: node.lang, code: node.content, attrs: node.attrs, header: node.header })
          return `${ctx.indent(ctx.level)}${marker(blocks.length - 1)}`
        },
      },
    },
    async apply(html) {
      const rendered = await Promise.all(blocks.map((block) => highlighter.highlight(block)))
      return rendered.reduce((out, block, i) => out.replace(marker(i), () => block), html)
    },
  }
}
