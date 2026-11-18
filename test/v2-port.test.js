import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCarveRenderer, extractFrontmatter } from '../src/index.js'

describe('Carve 0.2 public API boundary', () => {
  it('reads the 0.2 frontmatter child for Eleventy data', () => {
    expect(extractFrontmatter('---json\n{"title":"Page"}\n---\n\n= Page\n')).toEqual({ title: 'Page' })
  })

  it('reports render diagnostics and keeps the secure URL default', () => {
    const warnings = []
    const html = createCarveRenderer({ onWarning: (warning) => warnings.push(warning) })('[x](javascript:alert(1))\n')
    expect(html).toContain('href=""')
    expect(warnings.map((warning) => warning.code)).toEqual(['destination-denied'])
    expect(warnings[0].channel).toBe('render-loss')
  })

  it('passes 0.2 lint rule states through', () => {
    const warnings = []
    createCarveRenderer({ lint: { rules: { 'non-descriptive-link-text': 'on' } }, onWarning: (warning) => warnings.push(warning) })('See [click here](https://example.com).\n')
    expect(warnings.some((warning) => warning.code === 'non-descriptive-link-text')).toBe(true)
  })

  it('expands includes and reports their paths as Eleventy dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'eleventy-carve-v2-'))
    writeFileSync(join(root, 'part.crv'), 'Included.\n')
    const dependencies = []
    const html = createCarveRenderer({ includeRoot: root, onDependency: (dependency) => dependencies.push(dependency) }, join(root, 'page.crv'))('{{ part.crv }}\n')
    expect(html).toContain('Included.')
    expect(dependencies.map((dependency) => dependency.id)).toEqual([join(root, 'part.crv')])
  })

  it('refuses invalid 0.2 rendering options', () => {
    expect(() => createCarveRenderer({ carveOptions: { headingIds: 'not-a-mode' } })('= Page\n')).toThrow(/headingIds/)
  })

  it('retains the wikilinks option with a clear unavailable error', () => {
    expect(() => createCarveRenderer({ wikilinks: true })('[[Page]]')).toThrow(/wikilinks are not available yet in Carve 0.2/)
  })

  it.skip('wiki link collection resolution awaits the Carve 0.2 bracket syntax parser hook in carve-js#5047', () => {
    expect(createCarveRenderer({ wikilinks: true })('[[Page]]')).toContain('href="page"')
  })
})
