import { wikilinks } from '@markup-carve/carve'

/** The slug carve-js uses when no URL generator is given. */
export function wikiSlug(page) {
  return page.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_/]/g, '').replace(/-+/g, '-')
}

const indexes = new WeakMap()

function add(map, key, url) {
  if (!key) return
  const list = map.get(key) ?? []
  if (!list.includes(url)) list.push(url)
  map.set(key, list)
}

/**
 * Index one collection array by path stem, file slug and title. Eleventy
 * builds the array once per build, so it is indexed once per build.
 */
function indexOf(items) {
  let index = indexes.get(items)
  if (index) return index
  index = { stem: new Map(), file: new Map(), title: new Map() }
  for (const item of items) {
    if (typeof item?.url !== 'string') continue
    add(index.stem, wikiSlug(String(item.filePathStem ?? '').replace(/^\/+/, '')), item.url)
    add(index.file, wikiSlug(String(item.fileSlug ?? '')), item.url)
    if (typeof item.data?.title === 'string') add(index.title, wikiSlug(item.data.title), item.url)
  }
  indexes.set(items, index)
  return index
}

function lookup(items, page) {
  const index = indexOf(items)
  const key = wikiSlug(page)
  // A folder-qualified name only matches a path stem.
  const tries = key.includes('/') ? [index.stem.get(key)] : [index.stem.get(key), index.file.get(key), index.title.get(key)]
  for (const hits of tries) {
    if (hits?.length) return hits
  }
  return []
}

/**
 * Build the carve-js `wikilinks` extension for one render. `data` is the
 * Eleventy data the template renders with; without its collections, links
 * keep the carve-js slug.
 */
export function wikilinksExtension(options, data, onWarning) {
  const collection = options.collection ?? 'all'
  const items = data?.collections?.[collection]
  const reported = new Set()
  const warn = (code, page, message) => {
    if (reported.has(message)) return
    reported.add(message)
    onWarning({ code, page, message })
  }
  return wikilinks({
    cssClass: options.cssClass,
    newWindow: options.newWindow,
    urlGenerator(page) {
      if (page === '') return ''
      const custom = options.resolve?.(page, data)
      if (custom !== undefined) return custom
      if (!Array.isArray(items)) return wikiSlug(page)
      const hits = lookup(items, page)
      if (hits.length === 1) return hits[0]
      if (hits.length > 1) warn('wikilink-ambiguous', page, `Wiki link [[${page}]] matches several pages in collections.${collection}: ${hits.join(', ')}`)
      else warn('wikilink-unresolved', page, `Wiki link [[${page}]] matches no page in collections.${collection}`)
      return wikiSlug(page)
    },
  })
}
