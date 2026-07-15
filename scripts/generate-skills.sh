#!/usr/bin/env bash
# Regenerate src/data/skills.json from the liblouis tables (copies the macOS
# braille tables into data/ first if they are missing).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f data/en-ueb-g2.ctb ]; then
  ./scripts/copy-braille-tables.sh
fi
exec npm run generate
