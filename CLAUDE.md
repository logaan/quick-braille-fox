# CLAUDE.md

## Worktree workflow

Claude sessions do their work on branches in git worktrees under
`.claude/worktrees/`, so several sessions can run at once without treading on
each other or on the main checkout. This repo has no remote; everything is
merged locally.

**This is enforced, not merely described.** Instructions here were not enough
on their own, so two mechanisms back them up:

- `worktree.bgIsolation: "worktree"` (the default) blocks background sessions
  from editing the main checkout until they call `EnterWorktree`.
- The `PreToolUse` hook `.claude/hooks/require-worktree.sh` applies the same
  rule to interactive sessions, refusing `Edit`/`Write`/`NotebookEdit` on any
  file inside the main checkout.

So: **call `EnterWorktree` before your first edit.** Files outside this repo,
and files already inside `.claude/worktrees/`, are unaffected.

New worktrees branch from the current local `main` (`worktree.baseRef: "head"`
— with no remote there is nothing to fetch), and `node_modules` is symlinked in
rather than reinstalled (`worktree.symlinkDirectories`). Branching from local
`main` is exactly why finished work is merged immediately: the next session to
start inherits it.

When work on a worktree branch is complete:

1. Commit all changes on the worktree branch.
2. **Bring `main` into the branch first, from inside the worktree:**
   `git merge main`, resolving any conflicts there. Do this even when you
   expect no conflicts. The worktree is the one place edits are allowed, so
   resolving here is what keeps "merge immediately" and enforced isolation
   compatible.
3. Merge into `main` from the main checkout: `git -C <repo root> merge
   <branch>`. After step 2 this fast-forwards — it touches no files and needs
   no conflict resolution outside the worktree, so the guard never blocks it.
4. Rerun any scripts whose output is gitignored (e.g.
   `./scripts/copy-braille-tables.sh` to repopulate `data/`).
5. Delete the branch and remove the worktree **straight away**, so the next
   session starts from an up-to-date `main` and stale worktrees do not pile up.

Before removing a worktree, check it is not holding lot updates that exist
nowhere else — see "Lot vault" below.

### Editing the main checkout anyway

Set `CLAUDE_ALLOW_MAIN_EDITS=1` to lift the guard for one session. It is for
work that genuinely cannot happen in a worktree — resolving a conflict that
only exists in the main checkout, or changing repo-level config. Reach for it
deliberately; if the answer is "merge `main` into the branch first", do that
instead.

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

When that goes unnoticed, `lot` creates a *second* vault inside the worktree
and writes the session's updates there, where deleting the worktree destroys
them. It has happened. So before removing a worktree, check whether it holds
updates the real vault does not:

```bash
# Any update-ids under the worktree that are absent from the main vault?
comm -23 \
  <(rg -o --no-filename 'update-id: \S+' <worktree>/.lot-vault | sort -u) \
  <(rg -o --no-filename 'update-id: \S+' <repo root>/.lot-vault | sort -u)
```

Anything listed is real history that exists nowhere else. Copy each file into
the corresponding Thing's folder in the main vault, renumbering so filenames
still run in timestamp order (insert and shift the later files rather than
appending out of order), then confirm with `lot thing get <task-id>`.

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
