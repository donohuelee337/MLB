#!/usr/bin/env bash
# Push current worktree to the PREVIEW Apps Script project (sandbox sheet).
# Swaps .clasp.json ↔ .clasp.preview.json, pushes, then restores.
# Usage: bash scripts/clasp-preview.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .clasp.preview.json ]]; then
  echo "ERROR: .clasp.preview.json not found" >&2
  exit 1
fi

if grep -q "PASTE_PREVIEW_SCRIPT_ID_HERE" .clasp.preview.json; then
  echo "ERROR: Edit .clasp.preview.json and paste the preview Script ID first" >&2
  exit 1
fi

cleanup() {
  if [[ -f .clasp.live.json ]]; then
    mv .clasp.live.json .clasp.json
    echo "Restored .clasp.json -> live"
  fi
}
trap cleanup EXIT

mv .clasp.json .clasp.live.json
cp .clasp.preview.json .clasp.json
echo "Swapped .clasp.json -> preview, pushing..."
clasp push -f
