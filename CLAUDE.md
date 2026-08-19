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
5. **Deploy** from the main checkout: `./scripts/deploy`. See "Deploying"
   below.
6. Delete the branch and remove the worktree **straight away**, so the next
   session starts from an up-to-date `main` and stale worktrees do not pile up.

Before removing a worktree, check it is not holding lot updates that exist
nowhere else — see "Lot vault" below.

### Resurrecting an existing worktree

`EnterWorktree` with the `path` parameter can refuse to run from the repo
root ("the current working directory … is the repository root, not an
isolated worktree"), even for a worktree listed in `git worktree list`.
Creating a *new* worktree (the `name` parameter) works fine from the root;
it is only entering an existing one that fails. The sanctioned fallback is
to keep the session where it is and edit the worktree through absolute
paths — the require-worktree guard exempts everything under
`.claude/worktrees/`, so edits land in the worktree while the main checkout
stays protected. Run git commands with `git -C <worktree path>`.

### Editing the main checkout anyway

Set `CLAUDE_ALLOW_MAIN_EDITS=1` to lift the guard for one session. It is for
work that genuinely cannot happen in a worktree — resolving a conflict that
only exists in the main checkout, or changing repo-level config. Reach for it
deliberately; if the answer is "merge `main` into the branch first", do that
instead.

## Lot vault

The vault lives **outside this repo**, at
`~/code/personal/html/braille-grade2-lot-vault/`. `.lot.toml` points `lot` at
it by absolute path, so `lot` commands read and write that one vault from any
working directory, worktrees included. Nothing vault-related is tracked here
and nothing vault-related is ever merged.

Caveat: `$LOT_VAULT_PATH` bypasses config files entirely, so whatever a session
is launched with wins over `.lot.toml`. Modern `lot` always exports an absolute
path, but a *relative* one (an older binary, or a hand-set value) resolves
against the current directory — i.e. against the worktree — and `lot` then
creates a *second*, empty vault there and writes the session's updates into it,
where removing the worktree destroys them. It has happened.

The tell is `lot thing get <id>` reporting `no thing found with id …`, or
`lot thing list` returning `things: []`. That means the wrong vault, not a
deleted Thing. Check with `echo $LOT_VAULT_PATH`; if it is relative, pass the
absolute path explicitly for the rest of the session:

```bash
export LOT_VAULT_PATH=~/code/personal/html/braille-grade2-lot-vault
```

If updates were already written to a stray vault, before removing the worktree
check whether it holds any the real vault does not:

```bash
# Any update-ids under the worktree that are absent from the real vault?
comm -23 \
  <(rg -o --no-filename 'update-id: \S+' <worktree> | sort -u) \
  <(rg -o --no-filename 'update-id: \S+' ~/code/personal/html/braille-grade2-lot-vault | sort -u)
```

Anything listed is real history that exists nowhere else. Copy each file into
the corresponding Thing's folder in the real vault, renumbering so filenames
still run in timestamp order (insert and shift the later files rather than
appending out of order), then confirm with `lot thing get <task-id>`.

## Deploying

The app is published at <http://logpi.local/quick-braille-fox/>. **Finish every
task by committing the work and deploying it**, so the live site always matches
`main` — the user checks the change there rather than in a dev server.

Run it from the **main checkout**, after the branch has been merged into `main`
(step 3 of the worktree workflow above), so what goes live is what `main` says:

```bash
./scripts/deploy
```

The script builds first and then rsyncs `dist/` to
`logan@logpi.local:www/quick-braille-fox/` — never rsync a stale `dist/` by
hand, as the comments in `scripts/deploy` explain. It needs the Pi to be
reachable over SSH; if it is not, say so in the final report rather than
quietly leaving the task undeployed.

A change that ships nothing (a CLAUDE.md-only edit, say) deploys an identical
build, so skipping the deploy there is fine — when in doubt, deploy.

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
