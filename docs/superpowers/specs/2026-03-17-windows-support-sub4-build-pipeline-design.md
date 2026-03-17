# Windows Support Sub-project 4: Windows Build Pipeline — Design Spec

**Date:** 2026-03-17
**Branch:** feature/windows-support
**Status:** Approved

---

## Goal

Establish a GitHub Actions CI pipeline that builds an unsigned NSIS `.exe` installer for Windows. Configure `tauri.conf.json` with the `"nsis"` bundle target and Windows-specific metadata. This is Sub-project 4 of 5 in the Windows support effort.

---

## Background

The current build setup is macOS-only:
- `bundle.targets` in `tauri.conf.json` contains only `["dmg", "app"]`
- `scripts/build-release.sh` is a macOS-only script that locates and reports on `.dmg` artifacts
- No CI/CD pipeline exists (no `.github/` directory)

Sub-project 4 adds the build infrastructure needed to produce a Windows installer. The pipeline is configured for manual-trigger-only during this intermediate phase because the Windows binary will not successfully compile until Sub-project 5 (whisper-rs Metal gating) is complete. After Sub-project 5, triggering on version tags is a one-line addition.

---

## Scope

This sub-project covers:
- Adding `"nsis"` to `bundle.targets` in `tauri.conf.json`
- Adding `bundle.windows` and `bundle.nsis` configuration sections
- Creating `.github/workflows/build-windows.yml` with a `windows-latest` runner
- Adding a comment to `build-release.sh` noting that Windows builds are CI-only

**Out of scope:**
- Code signing (Authenticode) — deferred; unsigned builds trigger SmartScreen "More info → Run anyway", acceptable for beta
- `workflow_dispatch` → tag-triggered promotion — a one-line addition after Sub-project 5
- `whisper-rs` Metal gating — covered by Sub-project 5
- Cross-compilation from macOS — not viable for Tauri Windows builds
- MSI/WiX installer format — NSIS chosen; simpler toolchain, no WiX v3 required

---

## Architecture

Three files change. No new Rust code. No secrets required.

### Files Changed

| File | Change |
|------|--------|
| `.github/workflows/build-windows.yml` | New — GitHub Actions Windows build workflow |
| `src-tauri/tauri.conf.json` | Add `"nsis"` target; add `bundle.windows` and `bundle.nsis` sections |
| `scripts/build-release.sh` | Add comment noting Windows builds are CI-only (no functional change) |

---

## Files Changed

### 1. `.github/workflows/build-windows.yml`

New file. Triggers on `workflow_dispatch` (manual) only during the Sub-project 4 phase.

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

**Key decisions:**
- `windows-latest` is a real Windows Server runner with MSVC toolchain pre-installed — no cross-compilation
- `Swatinem/rust-cache` caches `target/` between runs; cold compile ~15 min, cached ~3 min
- `if-no-files-found: error` fails the job explicitly if the NSIS artifact is missing, rather than silently uploading nothing
- No secrets needed for an unsigned build

**After Sub-project 5:** Add to the `on:` block:
```yaml
  push:
    tags:
      - 'v*'
```

---

### 2. `src-tauri/tauri.conf.json`

Two additions to the existing `bundle` object.

**Change A — Add `"nsis"` to `targets`:**

```json
"targets": ["dmg", "app", "nsis"]
```

Tauri 2 automatically skips platform-incompatible targets at build time. `"dmg"` and `"app"` continue to build correctly on macOS; `"nsis"` only runs on Windows. No macOS build is affected.

**Change B — Add `bundle.windows` and `bundle.nsis` sections:**

```json
"windows": {
  "allowDowngrades": false
},
"nsis": {
  "installMode": "currentUser"
}
```

- `installMode: "currentUser"` installs to `%APPDATA%\OmWhisper` without requiring administrator/UAC elevation — better UX for end users
- `allowDowngrades: false` prevents installing an older version over a newer one without uninstalling first

The `bundle.macOS` section and all existing fields are unchanged.

---

### 3. `scripts/build-release.sh`

Add a comment after the script header explaining that Windows builds are handled by CI:

```bash
# Windows builds are produced by GitHub Actions (.github/workflows/build-windows.yml).
# This script is macOS-only and produces the .dmg artifact.
```

No functional change. This prevents future confusion about why there is no Windows equivalent of the local release script.

---

## Behavior After This Change

| Scenario | Before | After |
|----------|--------|-------|
| macOS `cargo tauri build` | Produces `.dmg` + `.app` | Unchanged |
| Windows CI (manual trigger) | No workflow | Produces `OmWhisper-Windows-NSIS` artifact |
| Windows build success | N/A | Blocked until Sub-project 5 (whisper-rs gating) |
| Code signing | N/A | Not implemented; SmartScreen shows "More info" dialog |

---

## Out of Scope

- Authenticode code signing
- MSI/WiX installer
- Tag-triggered CI promotion (add after Sub-project 5)
- `whisper-rs` Metal gating — Sub-project 5
- Any changes to Rust source files
