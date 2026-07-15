#!/usr/bin/env bash
# Start the Vite dev server.
set -euo pipefail
cd "$(dirname "$0")/.."
exec npm run dev -- "$@"
