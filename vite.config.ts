import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  // Deployed under a subpath (http://logpi.local/quick-braille-fox/), so built
  // asset URLs must be relative to index.html rather than rooted at "/".
  base: './',

  test: {
    // Claude sessions work on branches in git worktrees under
    // `.claude/worktrees/`. Those are full checkouts, so without this the
    // suite collects every other branch's copy of every test file as well as
    // this tree's — inflating the run and making the totals depend on which
    // worktrees happen to exist.
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
  },
})
