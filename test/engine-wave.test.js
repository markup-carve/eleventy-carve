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
    render('a\n\n---\n\nb\n')
    expect(warnings.map((w) => [w.code, w.severity, w.line])).toEqual([['thematic-break-spelling', 'Hint', 3]])
  })

  it('honor suppression comments', () => {
    const { render, warnings } = collecting({ lint: true })
    render('a\n\n%% carve-lint-disable-next-line thematic-break-spelling\n---\n\nb\n')
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

  it('skip an included file listed by a symlinked path', () => {
    const root = site({ 'real/part.crv': 'See [x](#gone).\n' })
    symlinkSync(join(root, 'real'), join(root, 'linked'), 'dir')
    const { render, warnings } = collecting({ lint: { ignoredFiles: [join(root, 'linked', 'part.crv')] } }, join(root, 'page.crv'))
    render('{{ linked/part.crv }}\n')
    expect(warnings).toEqual([])
  })

  it('report the deprecated glued cell alignment, not the braced one', () => {
    const glued = collecting({ lint: true })
    const gluedHtml = glued.render('|=< Plan |=> Price |\n| Basic | 10 |\n')
    const braced = collecting({ lint: true })
    const bracedHtml = braced.render('|={<} Plan |={>} Price |\n| Basic | 10 |\n')
    expect(glued.warnings.map((w) => w.code)).toEqual(['deprecated-cell-alignment', 'deprecated-cell-alignment'])
    expect(braced.warnings).toEqual([])
    expect(bracedHtml).toBe(gluedHtml)
    expect(bracedHtml).toContain('<th scope="col" style="text-align: right;">Price</th>')
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
