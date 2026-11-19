import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCarveRenderer } from '../src/index.js'

const roots = []
function site(files) {
  const root = mkdtempSync(join(tmpdir(), 'eleventy-carve-features-'))
  roots.push(root)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function collecting(options = {}, sourcePath) {
  const warnings = []
  const render = createCarveRenderer({ ...options, onWarning: (w) => warnings.push(w) }, sourcePath)
  return { render, warnings }
}

describe('@region includes', () => {
  it('splices only the named region of the included file', () => {
    const root = site({ 'shared.crv': 'Before.\n\n%% #region intro\nInside the region.\n%% #endregion\n\nAfter.\n' })
    const { render, warnings } = collecting({}, join(root, 'page.crv'))
    const html = render('{{ shared.crv @region:intro }}')
    expect(html).toContain('Inside the region.')
    expect(html).not.toContain('Before.')
    expect(html).not.toContain('After.')
    expect(warnings).toEqual([])
  })

  it('reports a missing region through onWarning', () => {
    const root = site({ 'shared.crv': 'Whole file.\n' })
    const { render, warnings } = collecting({}, join(root, 'page.crv'))
    expect(render('{{ shared.crv @region:nope }}')).not.toContain('Whole file.')
    expect(warnings.map((w) => w.rule)).toContain('include-region-invalid')
  })
})

describe('lint', () => {
  const source = '{#dup}\n= A\n\n{#dup}\n= B\n\nGo to [x](#nowhere). Fixes #12.\n'

  it('is off by default', () => {
    const { render, warnings } = collecting()
    render(source)
    expect(warnings.filter((warning) => warning.channel === 'lint')).toEqual([])
  })

  it('reports findings with the rule as code and the position in the message', () => {
    const { render, warnings } = collecting({ lint: true })
    render(source)
    const dup = warnings.find((w) => w.code === 'duplicate-id')
    expect(dup.message).toMatch(/\[duplicate-id\] \(line 4, column 2\)$/)
    expect(warnings.find((w) => w.code === 'broken-fragment-link').line).toBe(7)
    expect(warnings.some((w) => w.code === 'platform-issue-reference')).toBe(false)
  })

  it('adds platform rules on request', () => {
    const { render, warnings } = collecting({ lint: { platforms: ['github'] } })
    render(source)
    expect(warnings.some((w) => w.code === 'platform-issue-reference')).toBe(true)
  })

  it('names the included file a finding comes from', () => {
    const root = site({ 'part.crv': 'See [x](#gone).\n' })
    const { render, warnings } = collecting({ lint: true }, join(root, 'page.crv'))
    render('{{ part.crv }}\n')
    const finding = warnings.find((w) => w.code === 'broken-fragment-link')
    expect(finding.file).toContain('part.crv')
    expect(finding.message).toContain('part.crv')
  })
})

// U-408, C2-X-057: the 0.1 `[[Page]]` spelling is `:wiki[Page]` in 0.2; the cases below use it.
describe('wiki links', () => {
  const all = [
    { url: '/', fileSlug: 'index', filePathStem: '/index', data: { title: 'Home' } },
    { url: '/docs/getting-started/', fileSlug: 'getting-started', filePathStem: '/docs/getting-started', data: { title: 'Getting Started' } },
    { url: '/animals/tigers/', fileSlug: 'tigers', filePathStem: '/guides/tigers', data: { title: 'Big cats' } },
    { url: '/a/dup/', fileSlug: 'dup', filePathStem: '/a/dup', data: {} },
    { url: '/b/dup/', fileSlug: 'dup', filePathStem: '/b/dup', data: {} },
    { url: false, fileSlug: 'draft', filePathStem: '/draft', data: {} },
  ]
  const data = { collections: { all, posts: [all[1]] } }

  // C2-X-057: without the matcher, the target keeps its core-text fallback instead of 0.1's literal brackets.
  it('stay unlinked text unless enabled', () => {
    const html = createCarveRenderer()('See :wiki[Tigers].', data)
    expect(html).toContain('Tigers')
    expect(html).not.toContain('<a ')
  })

  it('resolve by path stem, file slug and title to the page URL', () => {
    const { render, warnings } = collecting({ wikilinks: true })
    const html = render(':wiki[docs/getting-started] :wiki[Tigers|stripes] :wiki[Big Cats#size] :wiki[Home] :wiki[#top]', data)
    expect(html).toContain('<a href="/docs/getting-started/" class="wikilink" data-wikilink="docs/getting-started">docs/getting-started</a>')
    expect(html).toContain('<a href="/animals/tigers/" class="wikilink" data-wikilink="Tigers">stripes</a>')
    expect(html).toContain('href="/animals/tigers/#size"')
    expect(html).toContain('href="/"')
    expect(html).toContain('href="#top"')
    expect(warnings).toEqual([])
  })

  it('warn once per render on a missing or ambiguous target and keep the carve-js slug', () => {
    const { render, warnings } = collecting({ wikilinks: true })
    const html = render(':wiki[Lions] :wiki[dup] :wiki[Lions] :wiki[draft] :wiki[x/tigers]', data)
    expect(html).toContain('href="lions"')
    expect(warnings.map((w) => w.code)).toEqual(['wikilink-unresolved', 'wikilink-ambiguous', 'wikilink-unresolved', 'wikilink-unresolved'])
    expect(warnings[1].message).toBe('Wiki link :wiki[dup] matches several pages in collections.all: /a/dup/, /b/dup/')
  })

  it('search the named collection only', () => {
    const { render, warnings } = collecting({ wikilinks: { collection: 'posts' } })
    expect(render(':wiki[Getting Started] :wiki[Tigers]', data)).toContain('href="/docs/getting-started/"')
    expect(warnings.map((w) => w.message)).toEqual(['Wiki link :wiki[Tigers] matches no page in collections.posts'])
  })

  it('try a custom resolver first, with the render data', () => {
    const resolve = (page, d) => (page === 'Tigers' && d === data ? 'https://example.org/tigers' : undefined)
    const html = createCarveRenderer({ wikilinks: { resolve, cssClass: 'wiki x', newWindow: true } })(':wiki[Tigers] :wiki[Home]', data)
    expect(html).toContain('href="https://example.org/tigers" class="wiki x" data-wikilink="Tigers" target="_blank" rel="noopener"')
    expect(html).toContain('href="/"')
  })

  it('use the carve-js slug without collections', () => {
    const { render, warnings } = collecting({ wikilinks: true })
    expect(render(':wiki[Big Cats]')).toContain('href="big-cats"')
    expect(warnings).toEqual([])
  })
})
