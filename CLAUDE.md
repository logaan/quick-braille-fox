# CLAUDE.md

## Worktree workflow

Claude sessions do their work on branches in git worktrees under
`.claude/worktrees/`. This repo has no remote; everything is merged locally.

When work on a worktree branch is complete:

1. Commit all changes on the worktree branch.
2. Merge the branch into `main` from the main checkout (which stays on
   `main`): `git -C <repo root> merge <branch>`.
3. Update the main checkout so it reflects the merged work: rerun any
   scripts whose output is gitignored (e.g. `./scripts/copy-braille-tables.sh`
   to repopulate `data/`).
4. Delete the merged branch and remove the worktree.

## Data files

`data/` is gitignored. It holds the liblouis braille tables copied from macOS
by `scripts/copy-braille-tables.sh`; run that script to (re)populate it.
