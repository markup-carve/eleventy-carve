import { describe, it, expect } from 'vitest'
import { createCarveRenderer, extractFrontmatter } from '../src/index.js'

describe('createCarveRenderer', () => {
  const render = createCarveRenderer()

  it('renders a heading', () => {
    const html = render('# Hello World')
    expect(html).toContain('<h1>Hello World</h1>')
  })

  it('renders bold (strong) inline markup', () => {
    const html = render('This is *bold* text')
    expect(html).toContain('<strong>bold</strong>')
  })

  it('renders a bullet list', () => {
    const html = render('- one\n- two\n- three')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>')
    expect(html).toContain('three')
  })

  it('renders a link', () => {
    const html = render('See [the site](https://example.com)')
    expect(html).toContain('<a href="https://example.com">the site</a>')
  })

  it('does NOT emit the frontmatter fence into the body output', () => {
    const html = render('---\ntitle: Hi\n---\n\n# Body')
    expect(html).toContain('<h1>Body</h1>')
    expect(html).not.toContain('title: Hi')
    expect(html).not.toContain('---')
  })

  it('forwards carveOptions to carve-js (lowercaseHeadingIds)', () => {
    const lower = createCarveRenderer({ carveOptions: { lowercaseHeadingIds: true } })
    const html = lower('# Hello World')
    // lowercased id slug
    expect(html).toContain('id="hello-world"')
  })
})

describe('extractFrontmatter', () => {
  it('parses bare (yaml) frontmatter into a data object', () => {
    const data = extractFrontmatter('---\ntitle: Hello\npermalink: /hi/\n---\n\n# Body')
    expect(data.title).toBe('Hello')
    expect(data.permalink).toBe('/hi/')
  })

  it('parses explicit ---json frontmatter', () => {
    const data = extractFrontmatter('---json\n{ "title": "JSON Page", "draft": true }\n---\n\nx')
    expect(data.title).toBe('JSON Page')
    expect(data.draft).toBe(true)
  })

  it('parses explicit ---toml frontmatter', () => {
    const data = extractFrontmatter('---toml\ntitle = "TOML Page"\ntags = ["a", "b"]\n---\n\nx')
    expect(data.title).toBe('TOML Page')
    expect(data.tags).toEqual(['a', 'b'])
  })

  it('returns an empty object when there is no frontmatter', () => {
    expect(extractFrontmatter('# Just a heading')).toEqual({})
  })
})
