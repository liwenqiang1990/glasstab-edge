#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/release/dist"
TMP_DIR="$ROOT_DIR/release/.package-tmp"

VERSION="$(
  sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT_DIR/manifest.json" | head -n 1
)"

if [[ -z "${VERSION}" ]]; then
  echo "Failed to read version from manifest.json" >&2
  exit 1
fi

PACKAGE_NAME="glasstab-edge-v${VERSION}.zip"
PACKAGE_PATH="$DIST_DIR/$PACKAGE_NAME"

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR" "$DIST_DIR"

copy_path() {
  local source="$1"
  if [[ ! -e "$ROOT_DIR/$source" ]]; then
    echo "Missing required path: $source" >&2
    exit 1
  fi
  cp -R "$ROOT_DIR/$source" "$TMP_DIR/$source"
}

copy_path "manifest.json"
copy_path "metadata.json"
copy_path "icon.png"
copy_path "background.js"
copy_path "tab.html"
copy_path "logic.js"
copy_path "popup.html"
copy_path "popup.js"
copy_path "options.html"
copy_path "options.js"
copy_path "bookmarks.html"
copy_path "bookmarks.js"
copy_path "shared"
copy_path "libs"

rm -f "$PACKAGE_PATH"

if command -v zip >/dev/null 2>&1; then
  (
    cd "$TMP_DIR"
    zip -qr "$PACKAGE_PATH" .
  )
elif command -v python3 >/dev/null 2>&1; then
  python3 - "$TMP_DIR" "$PACKAGE_PATH" <<'PY'
import os
import sys
import zipfile

root = sys.argv[1]
package_path = sys.argv[2]

with zipfile.ZipFile(package_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for current_root, _, files in os.walk(root):
        for filename in files:
            source = os.path.join(current_root, filename)
            arcname = os.path.relpath(source, root)
            zf.write(source, arcname)
PY
else
  echo "Neither zip nor python3 is available to create the package." >&2
  exit 1
fi

rm -rf "$TMP_DIR"

echo "Created package:"
echo "$PACKAGE_PATH"
