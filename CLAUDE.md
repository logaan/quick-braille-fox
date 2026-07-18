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

`.lot-vault/` is gitignored and not tracked. There is one vault, living in the
main checkout; `.lot.toml` points `lot` at it by absolute path, so `lot`
commands run from a worktree read and write that same vault. Worktrees do not
carry their own copy and there is nothing vault-related to merge.

Caveat: `$LOT_VAULT_PATH` bypasses config files entirely, and a session
launched with a *relative* value for it will resolve that path against the
current directory — i.e. against the worktree, not the main checkout. In a
session like that, run `lot` from the main checkout (e.g.
`(cd <repo root> && … | lot update work --thing …)`).

## Commands

Any command commonly run in this project (build, dev server, tests, data
generation, …) lives as a script in `scripts/`, so commands are discovered
by listing that folder rather than remembered. When a new common command
appears, add a script for it instead of documenting the raw invocation.

## Data files

`data/` is gitignored. It holds the liblouis braille tables copied from macOS
by `scripts/copy-braille-tables.sh`; run that script to (re)populate it.
