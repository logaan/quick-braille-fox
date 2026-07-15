#!/usr/bin/env bash
# Typecheck the whole project (tsc --noEmit), no build.
set -euo pipefail
cd "$(dirname "$0")/.."
exec npm run typecheck -- "$@"
