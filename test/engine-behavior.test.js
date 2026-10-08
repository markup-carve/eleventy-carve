import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCarveRenderer } from '../src/index.js'

/**
 * Engine behavior this renderer's own path reaches, and that no plugin diff
 * would announce. All three changed between the engine the lockfile held
 * (0.1.7) and the one a consumer resolves from `^0.1.7` (0.1.10).
 */
function render(source, { files, options } = {}) {
  const warnings = []
  let sourcePath
  let root
  if (files) {
    root = mkdtempSync(join(tmpdir(), 'eleventy-carve-behavior-'))
    mkdirSync(join(root, 'pages'))
    for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content)
    sourcePath = join(root, 'pages', 'index.crv')
  }
  try {
    const renderCarve = createCarveRenderer(
      { ...options, includeRoot: root, onWarning: (warning) => warnings.push(warning.message) },
      sourcePath ?? 'page.crv',
    )
    return { html: renderCarve(source), warnings }
  } finally {
    if (root) rmSync(root, { recursive: true, force: true })
  }
}

describe('engine behavior the renderer reaches', () => {
  it('leaves a case-only cross-reference literal instead of resolving it', () => {
    // Engine 0.1.7 resolved `</#alpha-beta>` against a heading whose id is
    // `Alpha-Beta`; 0.1.10 compares case exactly, so the reference degrades to
    // text and a built page gains visible markup where a link was.
    const { html } = render('# Alpha Beta\n\n</#alpha-beta>\n')

    expect(html).toContain('&lt;/#alpha-beta&gt;')
    expect(html).not.toContain('href="#Alpha-Beta"')
  })

  it('still resolves an exact cross-reference and clones the target text', () => {
    expect(render('# Alpha Beta\n\n</#Alpha-Beta>\n').html).toContain('href="#Alpha-Beta">Alpha Beta')
  })

  it('renames every colliding id an include brings in, not only a heading id', () => {
    // Engine 0.1.7 emitted three elements carrying id="dup" from one included
    // file, which is invalid HTML and makes the anchors collide.
    const { html, warnings } = render('{#dup}\nBefore.\n\n{{ ../child.crv }}\n\n{{ ../child.crv }}\n', {
      files: { 'child.crv': '{#sec}\n# Shared\n\n{#dup}\nA note.\n' },
    })

    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('dup-2')
    expect(warnings.filter((message) => /Id "dup" was renamed/.test(message))).toHaveLength(2)
  })

  it('reports a blanked destination scheme through the warning hook', () => {
    // The engine blanks `javascript:` either way; without the report the author
    // only sees a link that stopped working, with no position.
    for (const includes of [true, false]) {
      const { html, warnings } = render('[x](javascript:alert(1))\n', { options: { includes } })

      expect(html).toContain('href=""')
      expect(warnings).toContain('Blanked a denied destination scheme [destination-denied] (line 1, column 1)')
    }
  })
})
