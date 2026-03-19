#!/usr/bin/env bash
# notarize.sh — Notarize and staple the latest OmWhisper DMG
# Run after build-release.sh. Reads credentials from .env at project root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUNDLE_DIR="$PROJECT_ROOT/src-tauri/target/release/bundle/dmg"

# Load .env
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

# Validate credentials
for var in APPLE_ID APPLE_ID_PASSWORD APPLE_TEAM_ID; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set. Add it to your .env file."
    exit 1
  fi
done

# Find DMG
DMG_PATH=$(find "$BUNDLE_DIR" -name "*.dmg" 2>/dev/null | head -1)
if [ -z "$DMG_PATH" ]; then
  echo "ERROR: No .dmg found in $BUNDLE_DIR"
  echo "Run bash scripts/build-release.sh first."
  exit 1
fi

echo "DMG: $DMG_PATH"
echo ""

echo "Submitting to Apple notarization service (1–5 minutes)..."
xcrun notarytool submit "$DMG_PATH" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_ID_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

echo ""
echo "Stapling ticket to DMG..."
xcrun stapler staple "$DMG_PATH"

echo ""
echo "Verifying Gatekeeper..."
spctl --assess --type open --context context:primary-signature --verbose "$DMG_PATH" \
  && echo "✓ Gatekeeper: accepted" \
  || echo "✗ Gatekeeper check failed"

echo ""
echo "SHA-256: $(shasum -a 256 "$DMG_PATH" | awk '{print $1}')"
echo "Path:    $DMG_PATH"
echo ""
echo "Done. Ready to distribute."
