#!/bin/bash
#
# Copy the liblouis braille translation tables that macOS VoiceOver uses for
# Unified English Braille Grade 2 (contracted braille) into data/.
#
# macOS bundles liblouis inside the ScreenReader (VoiceOver) support files.
# The entry-point table for UEB Grade 2 is en-ueb-g2.ctb, which pulls in
# further tables via `include` directives. This script starts from the entry
# table and recursively copies everything it includes, so data/ ends up with
# a complete, self-contained set of table files.
#
# The copied files are Apple-shipped liblouis files (LGPL 2.1+) and are kept
# out of git history via .gitignore.

set -euo pipefail

TABLES_DIR="/System/Library/ScreenReader/BrailleTables/LiblouisBrailleTranslator.brailletable/Contents/Resources/liblouis/tables"
ENTRY_TABLE="en-ueb-g2.ctb"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$REPO_ROOT/data"

if [[ ! -f "$TABLES_DIR/$ENTRY_TABLE" ]]; then
  echo "error: $TABLES_DIR/$ENTRY_TABLE not found." >&2
  echo "The VoiceOver braille table location may have changed in this macOS version." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

# Breadth-first walk of the include graph starting at the entry table.
queue=("$ENTRY_TABLE")
copied=()

while ((${#queue[@]} > 0)); do
  table="${queue[0]}"
  queue=("${queue[@]:1}")

  # Skip anything already copied.
  for c in "${copied[@]:-}"; do
    [[ "$c" == "$table" ]] && continue 2
  done

  src="$TABLES_DIR/$table"
  if [[ ! -f "$src" ]]; then
    echo "warning: included table '$table' not found in $TABLES_DIR, skipping" >&2
    continue
  fi

  cp "$src" "$DEST_DIR/$table"
  copied+=("$table")
  echo "copied $table"

  # Include lines look like: include <filename> [trailing comment]
  while IFS= read -r inc; do
    queue+=("$inc")
  done < <(sed -n 's/^include[[:space:]]\{1,\}\([^[:space:]]\{1,\}\).*/\1/p' "$src")
done

echo
echo "${#copied[@]} table files copied to $DEST_DIR"
echo "Entry point: $DEST_DIR/$ENTRY_TABLE"
