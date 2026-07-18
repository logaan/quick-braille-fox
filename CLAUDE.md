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

## Claude suggestions

While working on a task, you'll often notice things about the project that
aren't working well — a rough edge in the tooling, a slow or awkward workflow,
a bug that's tangential to what you were asked to do, or a gap in the docs. If
fixing it isn't necessary for the task at hand, **don't fix it inline and don't
just mention it in passing**. Instead, file it as a suggestion so the user can
decide whether to act on it.

File a suggestion by creating a new Thing as a child of the top-level
"Claude suggestions" Thing (`lot:033rPj8TVaL2WyrRjmxFxA`). If that ID ever
stops resolving, find the Thing by name with `lot thing list`.

```bash
# Name as arguments, body (issue + proposed solution) on stdin:
echo "Body describing the issue and a proposed solution" \
  | lot thing new --parent lot:033rPj8TVaL2WyrRjmxFxA Short suggestion title
```

Each suggestion should:

- **Describe the issue** — what isn't working well and, where it helps, how you
  hit it.
- **Describe a solution** — a concrete proposed fix or improvement.

Keep the suggestion focused on the one improvement; file separate Things for
unrelated issues. If the user likes a suggestion they'll use `lot`'s send-to-
Claude function to have it implemented.

Examples of the kind of thing worth filing: Vite running tests in `.claude`
worktrees when executed from the base worktree, or a `MAP.md` file to save each
task from re-learning the project's layout from scratch.
