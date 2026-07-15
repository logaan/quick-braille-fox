#!/usr/bin/env bash
# Serve the production build from dist/ locally (vite preview).
set -euo pipefail
cd "$(dirname "$0")/.."
exec npm run preview -- "$@"
