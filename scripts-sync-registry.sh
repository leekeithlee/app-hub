#!/usr/bin/env bash
# Sync the canonical app registry into this repo's tracked snapshot.
# Canonical: ~/apps/registry.json  (read at runtime by src/lib.js via APPS_ROOT)
set -euo pipefail
SRC="${1:-/home/homea/apps/registry.json}"
DEST="$(dirname "$(readlink -f "$0")")/registry.json"
if [ ! -f "$SRC" ]; then echo "source not found: $SRC" >&2; exit 1; fi
if cmp -s "$SRC" "$DEST"; then
  echo "registry.json already in sync"
  exit 0
fi
cp "$SRC" "$DEST"
cd "$(dirname "$DEST")"
git add registry.json
git commit -m "chore: update app registry snapshot"
git push origin main
echo "registry snapshot updated and pushed"
