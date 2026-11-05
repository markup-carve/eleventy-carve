import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import carvePlugin from '../src/index.js'

// Eleventy comes from the example's install, like the build test.
const eleventyEntry = new URL('../example/node_modules/@11ty/eleventy/src/Eleventy.js', import.meta.url)

const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

async function build(files, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'eleventy-carve-source-'))
  roots.push(root)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, 'input', file, '..'), { recursive: true })
    writeFileSync(join(root, 'input', file), text)
  }
  const { default: Eleventy } = await import(eleventyEntry.href)
  const warnings = []
  const eleventy = new Eleventy(join(root, 'input'), join(root, '_site'), {
    quietMode: true,
    config(config) {
      config.addPlugin(carvePlugin, { ...options, onWarning: (warning) => warnings.push(warning) })
    },
  })
  eleventy.setIsVerbose(false)
  const pages = await eleventy.toJSON()
  return { pages: Object.fromEntries(pages.map((page) => [page.inputPath.replace(/^.*input\//, ''), page])), warnings }
}

describe('a template renders from the whole file', () => {
  it('keeps a body that opens with a dash line after the frontmatter', async () => {
    const { pages } = await build({ 'page.crv': '---\ntitle: Rule\n---\n---\nAfter the rule.\n---\n\nBody text.\n' })
    expect(pages['page.crv'].content).toBe('<hr>\n<p>After the rule.</p>\n<hr>\n<p>Body text.</p>')
  })

  it('reports lint positions as lines of the file, frontmatter included', async () => {
    const { warnings } = await build({ 'page.crv': '---\ntitle: Dup\n---\n\n# A\n\n# A\n' }, { lint: true })
    const dup = warnings.find((warning) => warning.code === 'duplicate-heading-id')
    expect(dup.line).toBe(7)
  })

  it('renders a computed string as given even when it is the end of the file', async () => {
    const { pages } = await build({
      '_includes/show.njk': '[{{ summary | safe }}]',
      'page.crv': '---\nlayout: show.njk\neleventyComputed:\n  summary: "# Final"\n---\nEarlier.\n\n# Final',
    })
    expect(pages['page.crv'].content).not.toContain('Earlier.')
    expect(pages['page.crv'].content).toContain('<h1>Final</h1>')
  })

  it('still renders a template with no frontmatter', async () => {
    const { pages } = await build({ 'plain.crv': '# Plain\n' })
    expect(pages['plain.crv'].content).toContain('<h1>Plain</h1>')
  })
})
