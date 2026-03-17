# Windows Build Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions Windows CI workflow and configure `tauri.conf.json` with the NSIS installer target so OmWhisper can produce a Windows `.exe` installer from a `windows-latest` runner.

**Architecture:** Three small config/file changes — no Rust code. `tauri.conf.json` gains `"nsis"` in targets plus `bundle.windows` and `bundle.nsis` sections. A new `.github/workflows/build-windows.yml` file sets up the full Windows build pipeline. `build-release.sh` gets a comment noting Windows builds are CI-only. The workflow is manual-trigger-only until Sub-project 5 (whisper-rs Metal gating) makes the Windows binary actually compile.

**Tech Stack:** GitHub Actions (`windows-latest` runner), Tauri 2 CLI (`@tauri-apps/cli`), NSIS installer format, Node 20, Rust stable (MSVC toolchain)

**Spec:** `docs/superpowers/specs/2026-03-17-windows-support-sub4-build-pipeline-design.md`

---

## Chunk 1: All Changes

### Task 1: Add NSIS target and Windows bundle config to tauri.conf.json

**Files:**
- Modify: `src-tauri/tauri.conf.json`

**Context:** `tauri.conf.json` currently has `"targets": ["dmg", "app"]` (macOS-only). Tauri 2 automatically skips platform-incompatible targets at build time, so adding `"nsis"` will not break macOS builds. The `bundle.windows.allowDowngrades` and `bundle.nsis.installMode` fields configure the NSIS installer behavior.

- [ ] **Step 1: Update tauri.conf.json**

Replace the entire file with:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "OmWhisper",
  "version": "0.1.0",
  "identifier": "com.omwhisper.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "",
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "width": 780,
        "height": 560,
        "minWidth": 680,
        "minHeight": 480,
        "resizable": true,
        "fullscreen": false,
        "visible": false,
        "skipTaskbar": true
      },
      {
        "label": "overlay",
        "title": "OmWhisper Overlay",
        "width": 280,
        "height": 100,
        "visible": false,
        "decorations": false,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "resizable": false,
        "transparent": true,
        "url": "/"
      }
    ],
    "macOSPrivateApi": true,
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["dmg", "app", "nsis"],
    "resources": {
      "resources/sounds/*": "sounds/"
    },
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "shortDescription": "Your voice, transcribed instantly. Private by design.",
    "longDescription": "OmWhisper transcribes your voice in real-time using on-device Whisper AI. No internet required, no data leaves your Mac. Works system-wide with a global hotkey.",
    "copyright": "© 2026 OmWhisper",
    "category": "Productivity",
    "macOS": {
      "minimumSystemVersion": "13.0",
      "dmg": {
        "windowSize": { "width": 660, "height": 400 },
        "appPosition": { "x": 180, "y": 170 },
        "applicationFolderPosition": { "x": 480, "y": 170 }
      }
    },
    "windows": {
      "allowDowngrades": false
    },
    "nsis": {
      "installMode": "currentUser"
    }
  }
}
```

- [ ] **Step 2: Validate the JSON is well-formed**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri
python3 -c "import json; json.load(open('tauri.conf.json')); print('JSON valid')"
```

Expected: `JSON valid`

- [ ] **Step 3: Verify macOS build still resolves (cargo check)**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri
cargo check
```

Expected: no errors. (This confirms `tauri.conf.json` changes don't break the macOS Rust build.)

- [ ] **Step 4: Commit**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper
git add src-tauri/tauri.conf.json
git commit -m "feat: add NSIS Windows installer target to tauri.conf.json"
```

---

### Task 2: Create GitHub Actions Windows build workflow

**Files:**
- Create: `.github/workflows/build-windows.yml`

**Context:** This workflow runs on `windows-latest` — a real Windows Server VM with the MSVC toolchain pre-installed. It installs Node 20 and Rust stable, caches the Rust `target/` directory between runs (saves ~12 minutes per run after first), builds the frontend, runs `cargo tauri build`, then uploads the NSIS `.exe` artifact. The workflow is `workflow_dispatch` only for now because the Windows binary won't compile until Sub-project 5 gates `whisper-rs`'s `metal` feature.

- [ ] **Step 1: Create the .github/workflows directory and workflow file**

Create `.github/workflows/build-windows.yml` with this content:

```yaml
name: Build Windows

on:
  workflow_dispatch:

jobs:
  build-windows:
    runs-on: windows-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Set up Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Cache Rust build
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Install frontend dependencies
        run: npm ci

      - name: Build Tauri app
        run: npx @tauri-apps/cli build

      - name: Upload NSIS installer
        uses: actions/upload-artifact@v4
        with:
          name: OmWhisper-Windows-NSIS
          path: src-tauri/target/release/bundle/nsis/*.exe
          if-no-files-found: error
```

- [ ] **Step 2: Validate YAML is well-formed**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-windows.yml')); print('YAML valid')" 2>/dev/null || python3 -c "
import sys
try:
    import yaml
    yaml.safe_load(open('.github/workflows/build-windows.yml'))
    print('YAML valid')
except ImportError:
    # PyYAML not installed — check structure manually
    content = open('.github/workflows/build-windows.yml').read()
    assert 'workflow_dispatch' in content
    assert 'windows-latest' in content
    assert 'upload-artifact' in content
    print('YAML structure check passed (PyYAML not available)')
"
```

Expected: `YAML valid` or `YAML structure check passed`

- [ ] **Step 3: Verify workflow file exists at correct path**

```bash
ls -la /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/.github/workflows/build-windows.yml
```

Expected: file listed with non-zero size.

- [ ] **Step 4: Commit**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper
git add .github/workflows/build-windows.yml
git commit -m "feat: add GitHub Actions Windows build workflow (manual trigger)"
```

---

### Task 3: Add Windows CI note to build-release.sh

**Files:**
- Modify: `scripts/build-release.sh`

**Context:** The existing `build-release.sh` is macOS-only. Adding a comment prevents future confusion about why there's no local Windows equivalent.

- [ ] **Step 1: Add comment after the shebang/set line**

In `scripts/build-release.sh`, find this block at the top:

```bash
#!/usr/bin/env bash
# build-release.sh — Build OmWhisper release .dmg and print distribution info
set -euo pipefail
```

Replace with:

```bash
#!/usr/bin/env bash
# build-release.sh — Build OmWhisper release .dmg and print distribution info
# macOS only. Windows builds are produced by GitHub Actions (.github/workflows/build-windows.yml).
set -euo pipefail
```

- [ ] **Step 2: Verify the script is still executable and bash-valid**

```bash
bash -n /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/scripts/build-release.sh && echo "Syntax OK"
```

Expected: `Syntax OK`

- [ ] **Step 3: Run cargo check one final time to confirm nothing regressed**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper
git add scripts/build-release.sh
git commit -m "docs: note Windows builds are CI-only in build-release.sh"
```
