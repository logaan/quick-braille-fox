#!/bin/bash
# Refuse edits to files in the main checkout — they belong in a worktree.
#
# `worktree.bgIsolation` already enforces this for background sessions; this
# hook extends the same rule to interactive ones, so the workflow holds however
# a session was started. See CLAUDE.md "Worktree workflow".
#
# Judged per target file, not per working directory: a file inside
# .claude/worktrees/ is fine, a file outside the repo entirely is none of our
# business, and only a file in the main checkout is refused.
#
# Escape hatch: CLAUDE_ALLOW_MAIN_EDITS=1 (see CLAUDE.md for when it is right).

set -uo pipefail

allow() { exit 0; }

deny() {
  jq -nc --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

[[ "${CLAUDE_ALLOW_MAIN_EDITS:-}" == "1" ]] && allow

input=$(cat)
file=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input")
[[ -z "$file" ]] && allow

# A path under .claude/worktrees/ is an isolated copy — always fine.
[[ "$file" == *"/.claude/worktrees/"* ]] && allow

# Locate the main checkout: --git-common-dir resolves to the *shared* .git even
# from inside a worktree, so its parent is the main working copy.
dir=$(dirname "$file")
while [[ ! -d "$dir" && "$dir" != "/" ]]; do dir=$(dirname "$dir"); done
common=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || allow
[[ -z "$common" ]] && allow
main_root=$(dirname "$common")

# Only guard files inside that checkout; anything else is unrelated.
[[ "$file" == "$main_root"/* ]] || allow

deny "This project keeps agent work in git worktrees so parallel sessions cannot
collide (CLAUDE.md > Worktree workflow), and ${file#"$main_root"/} is in the main
checkout at $main_root.

Call EnterWorktree, then redo this edit against the worktree path.

Merging a finished branch does NOT need an exception: merge main into your
branch inside the worktree and resolve conflicts there, so the merge into main
is a fast-forward that touches no files.

If you genuinely must edit the main checkout (resolving a conflict that only
exists there, or a repo-level config change), rerun with
CLAUDE_ALLOW_MAIN_EDITS=1 set — deliberately, not as a reflex."
