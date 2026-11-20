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
    // The Carve grammar highlights CSV and TSV fence bodies with these.
    langs: [grammars.carveGrammar, grammars.carveCsvGrammar, grammars.carveTsvGrammar, ...(options.langs ?? [])],
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
          for (const [key, value] of attrs?.keyValues ?? []) node.properties[key] = value
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
// Shared so every `highlight: true` render hits the cache.
const DEFAULTS = {}

/** One highlighter per options object, or none when highlighting is off. */
export function highlighterFor(option) {
  if (!option) return undefined
  const config = option === true ? DEFAULTS : option
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
    forDocument(document) {
      const languages = new Set()
      const visit = (value) => {
        if (!value || typeof value !== 'object') return
        if (value.type === 'code_block' && value.syntax && highlighter.accepts(value.syntax)) languages.add(value.syntax)
        for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit)
      }
      visit(document)
      const extensions = []
      const renderers = {}
      for (const [index, language] of [...languages].entries()) {
        const name = `eleventy.shiki${index}`
        extensions.push({
          name, version: '1', matcher: { form: 'fence', name: language },
          props: { language: 'string', title: 'string' }, slots: {},
          transform(claim) {
            if (claim.form !== 'fence') return null
            return {
              type: 'block_extension', name, version: '1', children: [],
              props: { language, title: claim.title ?? '' },
              fallback: [structuredClone(claim.node)],
              payload: [{ format: 'text/plain', value: claim.value }],
            }
          },
        })
        renderers[name] = {
          version: '1',
          render(node) {
            blocks.push({ lang: node.props.language, code: node.payload[0].value, attrs: node.attrs, header: node.props.title || undefined })
            return marker(blocks.length - 1)
          },
        }
      }
      return { extensions, renderers }
    },
    async apply(html) {
      const rendered = await Promise.all(blocks.map((block) => highlighter.highlight(block)))
      return rendered.reduce((out, block, i) => out.replace(marker(i), () => block), html)
    },
  }
}
