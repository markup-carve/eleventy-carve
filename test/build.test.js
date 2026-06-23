import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const exampleDir = fileURLToPath(new URL('../example', import.meta.url))
const siteDir = path.join(exampleDir, '_site')

// Real Eleventy build of the example site. Requires the example's own
// node_modules (run `npm install` inside example/ first). The build is the
// authoritative end-to-end check: Carve -> HTML, frontmatter -> data cascade,
// permalink honored.
describe('real Eleventy build of example/', () => {
  beforeAll(() => {
    if (!existsSync(path.join(exampleDir, 'node_modules', '@11ty', 'eleventy'))) {
      throw new Error(
        'example/ is not installed — run `npm install` inside example/ before this test',
      )
    }
    rmSync(siteDir, { recursive: true, force: true })
    execFileSync('npx', ['@11ty/eleventy'], { cwd: exampleDir, stdio: 'pipe' })
  }, 60000)

  it('renders the Carve body to HTML (heading, bold, list, link)', () => {
    const html = readFileSync(path.join(siteDir, 'index.html'), 'utf8')
    expect(html).toContain('<h1>Welcome to Carve on Eleventy</h1>')
    expect(html).toContain('<strong>Carve</strong>')
    expect(html).toContain('<li>first item</li>')
    expect(html).toContain('<a href="https://markup-carve.github.io/carve/">the Carve project</a>')
  })

  it('honors YAML frontmatter title via the layout (data cascade)', () => {
    const html = readFileSync(path.join(siteDir, 'index.html'), 'utf8')
    expect(html).toContain('<title>Carve Home</title>')
  })

  it('honors TOML frontmatter permalink (writes to /about-us/index.html)', () => {
    const target = path.join(siteDir, 'about-us', 'index.html')
    expect(existsSync(target)).toBe(true)
    const html = readFileSync(target, 'utf8')
    expect(html).toContain('<title>About</title>')
    expect(html).toContain('<h1>About This Site</h1>')
  })
})
