#!/usr/bin/env bash
# Lint src/ with ESLint (typescript-eslint type-checked rules).
set -euo pipefail
cd "$(dirname "$0")/.."
exec npm run lint -- "$@"
