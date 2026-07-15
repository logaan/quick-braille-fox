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

## Lot vault

`.lot-vault/` is committed to git like any other content. Branches commit
their lot vault, including any updates `lot` writes while the session works.
Update files within a Thing's folder are numbered (`001.md`, `002.md`, …);
if both main and a branch added updates to the same Thing, renumber before
merging so filenames don't collide and numbering follows the updates'
timestamps.

## Commands

Any command commonly run in this project (build, dev server, tests, data
generation, …) lives as a script in `scripts/`, so commands are discovered
by listing that folder rather than remembered. When a new common command
appears, add a script for it instead of documenting the raw invocation.

## Data files

`data/` is gitignored. It holds the liblouis braille tables copied from macOS
by `scripts/copy-braille-tables.sh`; run that script to (re)populate it.
