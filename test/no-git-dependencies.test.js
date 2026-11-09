import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The git-dependency guard runs at publish time (release.yml), so this suite
 * runs the real script on scratch manifests on every pull request. A git pin of
 * a merged carve-js commit is allowed on main while an engine release is
 * pending; the release must still refuse it. Rows come from markup-carve/carve-grammars.
 */
const guard = fileURLToPath(new URL('../scripts/no-git-dependencies.mjs', import.meta.url))
const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
const committed = JSON.parse(readFileSync(manifestPath, 'utf8'))
// Scratch rows start from the committed manifest with the engine on a registry
// range, so each row's verdict depends only on the spec it changes.
const baseline = {
  ...committed,
  dependencies: { ...committed.dependencies, '@markup-carve/carve': '^0.1.14' },
}
const scratch = mkdtempSync(join(tmpdir(), 'eleventy-carve-guard-'))

function runGuard(manifestOrPath) {
  let path = manifestOrPath
  if (typeof manifestOrPath !== 'string') {
    path = join(scratch, 'package.json')
    writeFileSync(path, JSON.stringify(manifestOrPath, null, 2), 'utf8')
  }
  const run = spawnSync(process.execPath, [guard, path], { encoding: 'utf8' })
  expect(run.error).toBeUndefined()
  expect(run.status).not.toBeNull()
  return { status: run.status, out: `${run.stdout}${run.stderr}` }
}

const withDep = (spec) => ({
  ...baseline,
  dependencies: { ...baseline.dependencies, '@markup-carve/carve': spec },
})

const MATRIX = [
  ['a github: pin', withDep('github:markup-carve/carve-js#61f824d'), 'reject'],
  [
      'a git+https:// pin',
      withDep('git+https://github.com/markup-carve/carve-js.git#61f824d'),
      'reject',
  ],
  [
      'a bare owner/repo#sha shorthand',
      withDep('markup-carve/carve-js#61f824d5d5724bfaa26dd07dc5c159249a66c977'),
      'reject',
  ],
  [
      'a git spec in optionalDependencies',
      { ...baseline, optionalDependencies: { 'some-tool': 'github:markup-carve/some-tool#abc123' } },
      'reject',
  ],
  // Found by `codex review` on this branch, and present in both repos this
  // script was lifted from: an SCP-style git URL carries no protocol, and when
  // the repository sits at the root of its host it carries no slash either, so
  // the version above this one accepted it. `npm-package-arg` calls it `git`.
  ['an scp-style git URL with no slash', withDep('git@example.com:repo.git'), 'reject'],
  ['an scp-style git URL', withDep('git@github.com:markup-carve/carve-js.git'), 'reject'],
  ['an exact version', withDep('0.1.4'), 'accept'],
  ['a caret range', withDep('^0.1.4'), 'accept'],
  ['a dist-tag', withDep('latest'), 'accept'],
  ['a compound range', withDep('>=0.1.4 <0.2.0'), 'accept'],
  ['a prerelease version', withDep('0.2.0-beta.1'), 'accept'],
  // The near miss. An alias contains a slash and still resolves from the
  // registry, so over-rejecting it would break a manifest that is fine.
  ['an npm: alias', withDep('npm:@markup-carve/carve@^0.1.4'), 'accept'],
  /*
   * ALIAS TARGETS (#302). `npm:` used to return early and clean - an
   * unconditional ALLOW on a prefix, which is the same denylist mistake as the
   * URL-prefix list above, pointing the other way: it never asked what the
   * alias pointed AT. `npm-package-arg` refuses every reject row here with
   * "aliases only work for registry deps".
   *
   * BOTH DIRECTIONS, and the accept rows are the load-bearing half. The
   * failure mode of a fix for this is over-rejection - the rule collapsing
   * into "reject anything with a slash or an at-sign" - and an over-rejecting
   * guard is worse than the hole, because the next person who hits it
   * switches the guard off.
   */
  ['an npm: alias to a plain package', withDep('npm:some-pkg'), 'accept'],
  ['an npm: alias to a range', withDep('npm:some-pkg@^1.0.0'), 'accept'],
  ['an npm: alias to a scoped package', withDep('npm:@scope/pkg@^1.0.0'), 'accept'],
  ['an npm: alias to a dist-tag', withDep('npm:some-pkg@latest'), 'accept'],
  // `npm:foo@` is npm's `*`, the same alias as `npm:foo`.
  ['an npm: alias with an empty target', withDep('npm:some-pkg@'), 'accept'],
  // No separating `@` at all, so there is no target to recurse into - the
  // whole remainder is the alias's NAME, and that is what has to be refused.
  ['an npm: alias whose name is a git URL', withDep('npm:git+https://x/y'), 'reject'],
  ['an npm: alias whose name is a github: spec', withDep('npm:github:owner/repo'), 'reject'],
  ['an npm: alias whose name is a shorthand', withDep('npm:owner/repo'), 'reject'],
  // With a target, which recurses back through the same rule.
  ['an npm: alias targeting github:', withDep('npm:foo@github:owner/repo'), 'reject'],
  ['an npm: alias targeting git+https://', withDep('npm:foo@git+https://x/y.git'), 'reject'],
  ['an npm: alias targeting a shorthand', withDep('npm:foo@owner/repo'), 'reject'],
  ['an npm: alias targeting file:', withDep('npm:foo@file:../x'), 'reject'],
  ['an npm: alias targeting workspace:', withDep('npm:foo@workspace:*'), 'reject'],
  ['an npm: alias with no name at all', withDep('npm:'), 'reject'],
  ['a nested npm: alias', withDep('npm:foo@npm:bar@1'), 'reject'],
  /*
   * PUNCTUATION npm REFUSES, found by `codex review` on #302 one layer under
   * the alias hole it was reviewing. npm rejects a package name or a dist-tag
   * carrying "any characters that encodeURIComponent encodes" - its own words -
   * and the guard accepted all of these.
   *
   * The accept rows below it are why this is two character rules and not one. A
   * semver RANGE is not held to the tag rule: `^1.0.0` and `1.0.0 || 2.0.0`
   * carry characters encodeURIComponent encodes, and rejecting those would be
   * the over-reach this guard is written to avoid. So does `my!tag`, which is a
   * perfectly valid dist-tag and looks like nonsense.
   */
  ['an alias name with a fragment', withDep('npm:foo#bar'), 'reject'],
  ['an alias name with a query', withDep('npm:foo?bar'), 'reject'],
  ['an alias name with a percent', withDep('npm:foo%bar'), 'reject'],
  ['an alias scope with a fragment', withDep('npm:@scope#bar/pkg'), 'reject'],
  ['an alias targeting a bad tag', withDep('npm:foo@#bad'), 'reject'],
  ['a bare spec with a fragment', withDep('#bad'), 'reject'],
  ['a bare spec with braces', withDep('{x}'), 'reject'],
  ['a bare spec with a comma', withDep('a,b'), 'reject'],
  ['a dist-tag that only looks odd', withDep('my!tag'), 'accept'],
  ['a dist-tag with parentheses', withDep('a(b)'), 'accept'],
  ['a version with build metadata', withDep('1.0.0+build.1'), 'accept'],
  ['an alias to a tilde-led name', withDep('npm:~foo'), 'accept'],
  // A range's whitespace need not be a space, which is why the class above
  // admits all of it. Also found by `codex review`, and the reason the guard is
  // knowingly lenient on one spelling - see the whitespace note in the script.
  ['a range separated by a tab', withDep('>=1\t<2'), 'accept'],
  ['a range broken across lines', withDep('1.0.0\n|| 2.0.0'), 'accept'],
  // A scope with no package. Also `codex review`, and the third thing it found
  // under this one change: every PATTERN written for an alias name grew a
  // fallback branch that let something through, which is why the shipped rule
  // counts `/`-separated pieces instead of matching a shape.
  ['a scope with no package', withDep('npm:@foo'), 'reject'],
  ['a scope with no package and a target', withDep('npm:@foo@1'), 'reject'],
  ['a scoped name with a third segment', withDep('npm:@scope/pkg/extra'), 'reject'],
  // npm's leading `.`/`_` rule is on the WHOLE name, so it never reaches a
  // scope - the fourth thing `codex review` found here, and the second
  // over-rejection. All three of the accept rows were rejected by the version
  // that applied the rule per segment.
  ['an alias to an underscored scope', withDep('npm:@_scope/pkg'), 'accept'],
  ['an alias to an underscored package in a scope', withDep('npm:@scope/_pkg'), 'accept'],
  ['an alias to a dotted scope', withDep('npm:@.scope/pkg'), 'accept'],
  ['an alias to a dotted package in a scope', withDep('npm:@scope/.pkg'), 'reject'],
  ['an alias to an underscored bare name', withDep('npm:_pkg'), 'reject'],
  // npm reads the alias prefix case-insensitively, and a case-sensitive test
  // sent `NPM:foo` down to the catch-all where its `:` got it rejected. The
  // fifth thing `codex review` found, and the third over-rejection - it only
  // became visible once there was something past the prefix worth reaching.
  ['an upper-case alias prefix', withDep('NPM:some-pkg'), 'accept'],
  ['a mixed-case alias prefix', withDep('Npm:some-pkg@^1.0.0'), 'accept'],
  ['a nested alias in upper case', withDep('npm:foo@NPM:bar'), 'reject'],
  // A target carrying leading whitespace, which slipped past the nested-alias
  // test and was then trimmed and read as a good alias one frame down. The
  // sixth and last thing `codex review` found on this change.
  ['a nested alias behind a space', withDep('npm:foo@ npm:bar'), 'reject'],
  ['a git target behind a space', withDep('npm:foo@ github:o/r'), 'reject'],
  ['a range behind a space', withDep('npm:foo@ ^1.0.0'), 'accept'],
  // A leading dot is a local path to npm, whatever follows it - `.`, `..`,
  // `./x` and `.x` are all directories, and none reaches the registry.
  ['a bare dot', withDep('.'), 'reject'],
  ['a parent directory', withDep('..'), 'reject'],
  ['a relative path', withDep('./local'), 'reject'],
  ['a dot-led tag lookalike', withDep('.x'), 'reject'],
  ['an alias targeting a directory', withDep('npm:foo@.'), 'reject'],
  // The near miss on that rule: a dot INSIDE a tag is ordinary.
  ['a tag ending in a dot', withDep('x.'), 'accept'],
];

describe('the publish-time git-dependency guard', () => {
  it.each(MATRIX)('%s: %s', (label, manifest, verdict) => {
    const { status, out } = runGuard(manifest)
    if (verdict === 'accept') {
      expect(status, `the guard rejected ${label}, which installs fine:\n${out}`).toBe(0)
      return
    }
    expect(status, `the guard passed ${label}, which needs git at install time`).not.toBe(0)
    const [field, spec] = Object.entries(manifest.optionalDependencies ?? {}).length
      ? ['optionalDependencies', Object.values(manifest.optionalDependencies)[0]]
      : ['dependencies', manifest.dependencies['@markup-carve/carve']]
    expect(out).toContain(field)
    expect(out).toContain(spec)
    expect(out).toMatch(/registry/i)
  })

  it('gives the committed manifest the verdict a release would', () => {
    const spec = committed.dependencies['@markup-carve/carve']
    const { status, out } = runGuard(manifestPath)
    if (/^(github|git|git\+[a-z]+):/.test(spec)) {
      // A pin of a merged carve-js commit is allowed here, and publish refuses it.
      expect(status, out).not.toBe(0)
      expect(out).toContain(spec)
    } else {
      expect(status, out).toBe(0)
    }
  })

  it('leaves devDependencies alone', () => {
    const { status } = runGuard({
      ...baseline,
      devDependencies: { ...baseline.devDependencies, something: 'github:someone/something#abc' },
    })
    expect(status).toBe(0)
  })

  it('is called by the release workflow ahead of the tag and the publish', () => {
    const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
    expect(workflow).toContain('node scripts/no-git-dependencies.mjs')
    expect(workflow).toMatch(/needs: \[manifest, npm-credential, tag\]/)
    expect(workflow).toMatch(/needs: \[manifest, npm-credential\]\n\s+environment: release/)
  })

  it('is not called by the pull request workflow', () => {
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
    expect(ci).not.toContain('no-git-dependencies')
  })
})
