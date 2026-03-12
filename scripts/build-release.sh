#!/usr/bin/env bash
# build-release.sh — Build OmWhisper release .dmg and print distribution info
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TAURI_DIR="$PROJECT_ROOT/src-tauri"

cd "$PROJECT_ROOT"

echo "╔════════════════════════════════════╗"
echo "║     OmWhisper Release Builder      ║"
echo "╚════════════════════════════════════╝"
echo ""

# Read version from Cargo.toml
VERSION=$(grep '^version' "$TAURI_DIR/Cargo.toml" | head -1 | sed 's/version = "\(.*\)"/\1/' | tr -d ' ')
echo "Version:  $VERSION"
echo "Arch:     $(uname -m)"
echo ""

# Build
echo "Building release binary..."
npm run build
cargo tauri build 2>&1 | tee /tmp/tauri-build.log | grep -E "Compiling|Finished|error|warning: unused" | tail -20

BUNDLE_DIR="$TAURI_DIR/target/release/bundle"

echo ""
echo "Locating artifacts..."

DMG_PATH=$(find "$BUNDLE_DIR/dmg" -name "*.dmg" 2>/dev/null | head -1)
APP_PATH=$(find "$BUNDLE_DIR/macos" -name "*.app" 2>/dev/null | head -1)

if [ -z "$DMG_PATH" ]; then
    echo "ERROR: No .dmg found in $BUNDLE_DIR/dmg"
    exit 1
fi

DMG_NAME=$(basename "$DMG_PATH")
DMG_SIZE=$(du -sh "$DMG_PATH" | cut -f1)
DMG_SHA256=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')

echo ""
echo "┌─────────────────────────────────────────────────────┐"
echo "│                Release Artifacts                     │"
echo "├─────────────────────────────────────────────────────┤"
printf "│ Version:  %-43s│\n" "$VERSION"
printf "│ DMG:      %-43s│\n" "$DMG_NAME"
printf "│ Size:     %-43s│\n" "$DMG_SIZE"
printf "│ SHA-256:  %-43s│\n" "${DMG_SHA256:0:43}"
printf "│           %-43s│\n" "${DMG_SHA256:43}"
echo "└─────────────────────────────────────────────────────┘"
echo ""
echo "DMG path:  $DMG_PATH"
if [ -n "$APP_PATH" ]; then
    echo ".app path: $APP_PATH"
fi
echo ""
echo "Upload the .dmg to your distribution host, then update:"
echo "  landing/public/api/version.json  →  latest: \"$VERSION\""
echo ""
echo "Done."
