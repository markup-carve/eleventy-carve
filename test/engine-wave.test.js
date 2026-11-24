import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import carvePlugin, { createCarveRenderer } from '../src/index.js'

// Behavior of the engine release after 0.1.15 that reaches this plugin.
const eleventyEntry = new URL('../example/node_modules/@11ty/eleventy/src/Eleventy.js', import.meta.url)

const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function site(files) {
  const root = mkdtempSync(join(tmpdir(), 'eleventy-carve-wave-'))
  roots.push(root)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}

function collecting(options = {}, sourcePath) {
  const warnings = []
  const render = createCarveRenderer({ ...options, onWarning: (w) => warnings.push(w) }, sourcePath)
  return { render, warnings }
}

describe('lint options', () => {
  it('pass the hint severity through to onWarning', () => {
    const { render, warnings } = collecting({ lint: true })
    render('a\n\nText {.x} here.\n')
    expect(warnings.map((w) => [w.code, w.severity, w.line])).toEqual([['unattached-inline-attribute', 'hint', 3]])
  })

  it('honor suppression comments', () => {
    const { render, warnings } = collecting({ lint: true })
    render('a\n\n%% carve-lint-disable-next-line unattached-inline-attribute\nText {.x} here.\n')
    expect(warnings).toEqual([])
  })

  it('add opt-in rules through enabledRules', () => {
    const source = 'See [click here](https://example.com).\n'
    const off = collecting({ lint: true })
    off.render(source)
    const on = collecting({ lint: { enabledRules: ['non-descriptive-link-text'] } })
    on.render(source)
    expect(off.warnings).toEqual([])
    expect(on.warnings.map((w) => w.code)).toEqual(['non-descriptive-link-text'])
  })

  it('skip findings in ignoredFiles', () => {
    const root = site({ 'part.crv': 'See [x](#gone).\n' })
    const page = join(root, 'page.crv')
    const all = collecting({ lint: true }, page)
    all.render('{{ part.crv }}\n')
    const some = collecting({ lint: { ignoredFiles: [join(root, 'part.crv')] } }, page)
    some.render('{{ part.crv }}\n')
    expect(all.warnings.map((w) => w.code)).toContain('broken-fragment-link')
    expect(some.warnings).toEqual([])
  })

  it('skip the template itself when includes are off', () => {
    const root = site({})
    const page = join(root, 'page.crv')
    const { render, warnings } = collecting({ includes: false, lint: { ignoredFiles: [page] } }, page)
    render('a\n\n---\n\nb\n')
    expect(warnings).toEqual([])
  })

  it('skip an included file listed by a symlinked path', () => {
    const root = site({ 'real/part.crv': 'See [x](#gone).\n' })
    symlinkSync(join(root, 'real'), join(root, 'linked'), 'dir')
    const { render, warnings } = collecting({ lint: { ignoredFiles: [join(root, 'linked', 'part.crv')] } }, join(root, 'page.crv'))
    render('{{ linked/part.crv }}\n')
    expect(warnings).toEqual([])
  })

  // deprecated-cell-alignment is an upgrade-only lint rule; upgradeHints reports the row.
  it('report the deprecated glued cell alignment, not the braced one', () => {
    const glued = collecting({ lint: true, upgradeHints: true })
    const gluedHtml = glued.render('|=< Plan |=> Price |\n| Basic | 10 |\n')
    const braced = collecting({ lint: true, upgradeHints: true })
    const bracedHtml = braced.render('|={<} Plan |={>} Price |\n| Basic | 10 |\n')
    expect(glued.warnings.map((w) => w.code)).toEqual(['U-056'])
    expect(braced.warnings).toEqual([])
    expect(gluedHtml).toContain('&lt; Plan')
    expect(bracedHtml).toContain('<th scope="col" style="text-align: right;">Price</th>')
  })
})

describe('upgradeHints', () => {
  const source = 'Text\n# Heading\n\nSome _underline_ and _more_.\n'

  it('is off by default', () => {
    const { render, warnings } = collecting()
    render(source)
    expect(warnings).toEqual([])
  })

  it('sends each upgrade row once to onWarning and renders the source as written', () => {
    const page = join(site({}), 'page.crv')
    const hinted = collecting({ upgradeHints: true }, page)
    const plain = collecting({}, page)
    expect(hinted.render(source)).toBe(plain.render(source))
    expect(hinted.warnings).toEqual([
      { code: 'U-001', rule: 'U-001', severity: 'warning', channel: 'upgrade', file: page, line: 2,
        message: 'Carve 0.1 source: blank line put above a block that 0.2 reads as a lazy line directly under text [U-001] (line 2)' },
      { code: 'U-065', rule: 'U-065', severity: 'warning', channel: 'upgrade', file: page, line: 4,
        message: 'Carve 0.1 source: bare underline put in braces [U-065] (line 4)' },
    ])
  })

  it('reports an upgrade row that needs a person even when nothing is rewritten', () => {
    const { render, warnings } = collecting({ upgradeHints: true })
    render('- a\n\n  b\n')
    expect(warnings.map((w) => w.message)).toEqual(['Carve 0.1 source: a loose list with one item is tight in 0.2, its first paragraph loses the paragraph element [U-021] (line 1)'])
  })

  it('reports 0.1 wiki links only when wikilinks is on', () => {
    const off = collecting({ upgradeHints: true })
    off.render('[[Page]]\n', {})
    const on = collecting({ upgradeHints: true, wikilinks: true })
    on.render('[[Page]]\n', { collections: { all: [] } })
    expect(off.warnings).toEqual([])
    expect(on.warnings.map((w) => w.code)).toEqual(['U-423'])
  })
})

describe('table includes', () => {
  it('select rows and columns of a CSV file', () => {
    const root = site({ 'data.csv': 'Plan,Price,Seats\nBasic,10,2\nPlus,20,4\nTeam,30,8\n' })
    const { render, warnings } = collecting({}, join(root, 'page.crv'))
    const html = render('{table}\n{{ data.csv @code:csv @rows:3-4 @cols:"Seats,Plan" }}\n')
    expect(warnings).toEqual([])
    expect(html).toContain('<td>4</td><td>Plus</td>')
    expect(html).toContain('<td>8</td><td>Team</td>')
    expect(html).not.toContain('Basic')
    expect(html).not.toContain('Price')
  })
})

describe('frontmatter without a closer', () => {
  it('takes the rest of the file as data and renders an empty page', async () => {
    const root = site({
      'input/_includes/show.njk': '[{{ title }}|{{ content | safe }}]',
      'input/open.crv': '---\nlayout: show.njk\ntitle: Open\n',
    })
    const { default: Eleventy } = await import(eleventyEntry.href)
    const eleventy = new Eleventy(join(root, 'input'), join(root, '_site'), {
      quietMode: true,
      config(config) { config.addPlugin(carvePlugin, { onWarning() {} }) },
    })
    const [page] = await eleventy.toJSON()
    expect(page.content).toBe('[Open|]')
  })
})
