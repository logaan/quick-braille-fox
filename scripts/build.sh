#!/usr/bin/env bash
# Typecheck (tsc --noEmit) and build the production bundle into dist/.
set -euo pipefail
cd "$(dirname "$0")/.."
exec npm run build -- "$@"
