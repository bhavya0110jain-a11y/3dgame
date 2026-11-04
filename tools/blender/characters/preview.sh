#!/usr/bin/env bash
# Usage: tools/blender/characters/preview.sh OUT.png COLS [--elev N] [--scale] model.glb...
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$1"; COLS="$2"; shift 2
/home/user/blender-venv/bin/python "$HERE/preview.py" "$OUT" "$@" > /dev/null 2>&1 || { echo "preview failed"; exit 1; }
mapfile -t TILES < "${OUT%.png}_tiles.txt"
python3 "$HERE/stitch.py" "$OUT" "$COLS" "${TILES[@]}"
