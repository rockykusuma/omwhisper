#!/usr/bin/env bash
# build-release.sh — Build OmWhisper release .dmg and print distribution info
# macOS only. Windows builds are produced by GitHub Actions (.github/workflows/build-windows.yml).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TAURI_DIR="$PROJECT_ROOT/src-tauri"

cd "$PROJECT_ROOT"

# Load .env if present (picks up APPLE_SIGNING_IDENTITY and other build vars)
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$PROJECT_ROOT/.env"
  set +a
fi

echo "╔════════════════════════════════════╗"
echo "║     OmWhisper Release Builder      ║"
echo "╚════════════════════════════════════╝"
echo ""

# Read version from Cargo.toml
VERSION=$(grep '^version' "$TAURI_DIR/Cargo.toml" | head -1 | sed 's/version = "\(.*\)"/\1/' | tr -d ' ')
echo "Version:  $VERSION"
echo "Arch:     $(uname -m)"
echo ""

# Code signing identity — must be set before running this script.
# export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
# Find your identity: security find-identity -v -p codesigning | grep "Developer ID"
if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "ERROR: APPLE_SIGNING_IDENTITY is not set."
  echo "  export APPLE_SIGNING_IDENTITY=\"Developer ID Application: Your Name (TEAMID)\""
  echo "  Find yours: security find-identity -v -p codesigning | grep 'Developer ID'"
  exit 1
fi
echo "Signing: $APPLE_SIGNING_IDENTITY"
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

# Fix: .VolumeIcon.icns must be invisible so it doesn't show as a file in the DMG window.
# Tauri creates it but doesn't always set the macOS invisible bit — we do it here.
echo "Fixing DMG volume icon visibility..."
WRITABLE_DMG="${DMG_PATH%.dmg}-rw.dmg"
hdiutil convert "$DMG_PATH" -format UDRW -o "$WRITABLE_DMG" -quiet
TMP_MOUNT=$(mktemp -d)
hdiutil attach -readwrite -noverify -mountpoint "$TMP_MOUNT" "$WRITABLE_DMG" -quiet
if [ -f "$TMP_MOUNT/.VolumeIcon.icns" ]; then
    rm -f "$TMP_MOUNT/.VolumeIcon.icns"
    echo "  ✓ .VolumeIcon.icns removed"
fi
sync
hdiutil detach "$TMP_MOUNT" -quiet
rm -f "$DMG_PATH"
hdiutil convert "$WRITABLE_DMG" -format UDZO -o "$DMG_PATH" -quiet
rm -f "$WRITABLE_DMG"
echo ""

# Notarization — runs if APPLE_ID, APPLE_ID_PASSWORD, and APPLE_TEAM_ID are set.
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_ID_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    echo "Notarizing DMG (this takes 1–5 minutes)..."
    xcrun notarytool submit "$DMG_PATH" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_ID_PASSWORD" \
        --team-id "$APPLE_TEAM_ID" \
        --wait

    echo ""
    echo "Stapling notarization ticket to DMG..."
    xcrun stapler staple "$DMG_PATH"

    echo ""
    echo "Verifying Gatekeeper acceptance..."
    spctl --assess --type open --context context:primary-signature --verbose "$DMG_PATH" && echo "✓ Gatekeeper: accepted" || echo "✗ Gatekeeper check failed"

    DMG_SHA256=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')
    echo ""
    echo "Notarized SHA-256: $DMG_SHA256"
else
    echo "Skipping notarization (APPLE_ID / APPLE_ID_PASSWORD / APPLE_TEAM_ID not set)."
fi

echo ""
echo "Upload the .dmg to your distribution host, then update:"
echo "  landing/public/api/version.json  →  latest: \"$VERSION\""
echo ""
echo "Done."
