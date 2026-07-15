#!/usr/bin/env bash
# Run the test suite once (vitest run).
set -euo pipefail
cd "$(dirname "$0")/.."
exec npm test -- "$@"
