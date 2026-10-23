import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCarveRenderer } from '../src/index.js'
import { codeCollector, createCarveHighlighter, highlighterFor } from '../src/highlight.js'

async function render(source, options = {}) {
  const collector = codeCollector(await createCarveHighlighter(options))
  return collector.apply(createCarveRenderer()(source, undefined, [collector.extension]))
}

describe('Shiki highlighting', () => {
  it('highlights a fence in a bundled language with the default theme', async () => {
    const html = await render('``` ts\nconst a: number = 1\n```\n')
    expect(html).toMatch(/<pre class="shiki github-dark" style="[^"]*" tabindex="0" data-language="ts"><code>/)
    expect(html).toContain('<span style="color:#F97583">const</span>')
  })

  it('highlights a Carve fence with the carve-grammars grammar and styling marks', async () => {
    const html = await render('``` carve\n*bold* and {~gone~}\n```\n')
    expect(html).toContain('data-language="carve"')
    expect(html).toContain('data-carve-strike')
  })

  it('highlights a file-backed render, the path every Eleventy template takes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eleventy-carve-shiki-'))
    try {
      const collector = codeCollector(await createCarveHighlighter())
      const html = await collector.apply(createCarveRenderer({}, join(root, 'page.crv'))('``` ts\nlet a\n```\n', undefined, [collector.extension]))
      expect(html).toContain('<pre class="shiki github-dark"')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('highlights a CSV fence body inside a Carve fence', async () => {
    const html = await render('```` carve\n``` csv\na,b\n```\n````\n')
    expect(html).toContain('<span style="color:#79B8FF;font-weight:bold">a</span><span style="color:#F97583">,</span>')
  })

  it('keeps the plain engine output for a fence without a language or with an unknown one', async () => {
    const html = await render('```\nplain\n```\n\n``` nosuchlang\nx < y\n```\n')
    expect(html).toContain('<pre><code>plain\n</code></pre>')
    expect(html).toContain('<pre><code class="language-nosuchlang">x &lt; y\n</code></pre>')
    expect(html).not.toContain('shiki')
  })

  it('carries fence attributes and the title onto the highlighted pre', async () => {
    const html = await render('{#ex .wide data-x="1"}\n``` js "src/a.js"\nlet a\n```\n')
    expect(html).toContain('id="ex"')
    expect(html).toMatch(/class="shiki github-dark wide"/)
    expect(html).toContain('data-x="1"')
    expect(html).toContain('title="src/a.js"')
  })

  it('honors dual themes and language aliases', async () => {
    const html = await render('``` mylang\nlet a\n```\n', {
      themes: { light: 'github-light', dark: 'github-dark' },
      langAlias: { mylang: 'js' },
    })
    expect(html).toContain('shiki-themes github-light github-dark')
    expect(html).toContain('--shiki-dark:')
    expect(html).toContain('data-language="mylang"')
  })

  it('is off unless asked and reuses one highlighter per options object', async () => {
    expect(highlighterFor(undefined)).toBeUndefined()
    const options = { theme: 'nord' }
    expect(highlighterFor(options)).toBe(highlighterFor(options))
    expect(highlighterFor(true)).toBe(highlighterFor(true))
  })
})
