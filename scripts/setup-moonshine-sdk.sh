#!/usr/bin/env bash
# setup-moonshine-sdk.sh — Copy Moonshine SDK dylibs into src-tauri/Frameworks/
#
# Run this once per developer machine before building, and again whenever the
# Moonshine SDK is rebuilt. The Frameworks/ directory is gitignored.
#
# Usage:
#   bash scripts/setup-moonshine-sdk.sh
#   MOONSHINE_SDK_ROOT=/custom/path bash scripts/setup-moonshine-sdk.sh

set -euo pipefail

SDK_ROOT="${MOONSHINE_SDK_ROOT:-/tmp/moonshine-sdk}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRAMEWORKS="$REPO_ROOT/src-tauri/Frameworks"

MOONSHINE_DYLIB="$SDK_ROOT/core/build/libmoonshine.dylib"
ORT_DYLIB="$SDK_ROOT/core/third-party/onnxruntime/lib/macos/arm64/libonnxruntime.1.23.2.dylib"

echo "Moonshine SDK setup"
echo "  SDK root:   $SDK_ROOT"
echo "  Frameworks: $FRAMEWORKS"
echo ""

for dylib in "$MOONSHINE_DYLIB" "$ORT_DYLIB"; do
    if [ ! -f "$dylib" ]; then
        echo "ERROR: $dylib not found."
        echo "Build the Moonshine SDK first:"
        echo "  cd /tmp/moonshine-sdk/core && mkdir -p build && cd build && cmake .. && make -j$(sysctl -n hw.ncpu)"
        exit 1
    fi
done

mkdir -p "$FRAMEWORKS"
cp "$MOONSHINE_DYLIB" "$FRAMEWORKS/"
cp "$ORT_DYLIB" "$FRAMEWORKS/"

echo "Copied:"
ls -lh "$FRAMEWORKS/"
echo ""
echo "Done. You can now run: cargo tauri build"
