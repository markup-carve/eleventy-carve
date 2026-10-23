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
  const source = '# A\n\n# A\n\nGo to [x](#nowhere). Fixes #12.\n'

  it('is off by default', () => {
    const { render, warnings } = collecting()
    render(source)
    expect(warnings).toEqual([])
  })

  it('reports findings with the rule as code and the position in the message', () => {
    const { render, warnings } = collecting({ lint: true })
    render(source)
    const dup = warnings.find((w) => w.code === 'duplicate-heading-id')
    expect(dup.message).toMatch(/\[duplicate-heading-id\] \(line 3, column 1\)$/)
    expect(warnings.find((w) => w.code === 'broken-fragment-link').line).toBe(5)
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

  it('stay literal unless enabled', () => {
    expect(createCarveRenderer()('See [[Tigers]].', data)).toContain('[[Tigers]]')
  })

  it('resolve by path stem, file slug and title to the page URL', () => {
    const { render, warnings } = collecting({ wikilinks: true })
    const html = render('[[docs/getting-started]] [[Tigers|stripes]] [[Big Cats#size]] [[Home]] [[#top]]', data)
    expect(html).toContain('<a href="/docs/getting-started/" class="wikilink" data-wikilink="docs/getting-started">docs/getting-started</a>')
    expect(html).toContain('<a href="/animals/tigers/" class="wikilink" data-wikilink="Tigers">stripes</a>')
    expect(html).toContain('href="/animals/tigers/#size"')
    expect(html).toContain('href="/"')
    expect(html).toContain('href="#top"')
    expect(warnings).toEqual([])
  })

  it('warn once per render on a missing or ambiguous target and keep the carve-js slug', () => {
    const { render, warnings } = collecting({ wikilinks: true })
    const html = render('[[Lions]] [[dup]] [[Lions]] [[draft]] [[x/tigers]]', data)
    expect(html).toContain('href="lions"')
    expect(warnings.map((w) => w.code)).toEqual(['wikilink-unresolved', 'wikilink-ambiguous', 'wikilink-unresolved', 'wikilink-unresolved'])
    expect(warnings[1].message).toBe('Wiki link [[dup]] matches several pages in collections.all: /a/dup/, /b/dup/')
  })

  it('search the named collection only', () => {
    const { render, warnings } = collecting({ wikilinks: { collection: 'posts' } })
    expect(render('[[Getting Started]] [[Tigers]]', data)).toContain('href="/docs/getting-started/"')
    expect(warnings.map((w) => w.message)).toEqual(['Wiki link [[Tigers]] matches no page in collections.posts'])
  })

  it('try a custom resolver first, with the render data', () => {
    const resolve = (page, d) => (page === 'Tigers' && d === data ? 'https://example.org/tigers' : undefined)
    const html = createCarveRenderer({ wikilinks: { resolve, cssClass: 'wiki x', newWindow: true } })('[[Tigers]] [[Home]]', data)
    expect(html).toContain('href="https://example.org/tigers" class="wiki x" data-wikilink="Tigers" target="_blank" rel="noopener"')
    expect(html).toContain('href="/"')
  })

  it('use the carve-js slug without collections', () => {
    const { render, warnings } = collecting({ wikilinks: true })
    expect(render('[[Big Cats]]')).toContain('href="big-cats"')
    expect(warnings).toEqual([])
  })
})
