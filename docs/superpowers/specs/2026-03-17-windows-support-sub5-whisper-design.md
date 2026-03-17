# Windows Support Sub-project 5: whisper-rs Windows Build — Design Spec

**Date:** 2026-03-17
**Branch:** feature/windows-support
**Status:** Approved

---

## Goal

Make `whisper-rs` compile on Windows by splitting its Metal GPU feature into a macOS-only Cargo target dependency. macOS retains Metal GPU-accelerated transcription. Windows and Linux use CPU-only inference. This is Sub-project 5 of 5 — the final piece required for a working Windows build.

---

## Background

`whisper-rs` wraps `whisper.cpp`. Its `metal` feature links against Apple's Metal GPU framework, which is macOS-only. The current `Cargo.toml` specifies:

```toml
whisper-rs = { version = "0.14", features = ["metal"] }
```

This is an unconditional dependency that fails to compile on Windows or Linux because Metal is not available. Two problems:

1. `Cargo.toml`: `features = ["metal"]` unconditionally requested — linker fails on Windows.
2. `engine.rs`: `ctx_params.use_gpu(true)` instructs whisper to use Metal GPU — meaningless and potentially problematic without the metal feature.

After Sub-projects 2–4, this is the last remaining compile blocker for Windows.

---

## Scope

This sub-project covers:
- Splitting the `whisper-rs` dependency so Metal is requested only on macOS
- Gating `ctx_params.use_gpu(true)` behind `#[cfg(target_os = "macos")]`
- Promoting the GitHub Actions Windows workflow from manual-trigger-only to also trigger on version tags

**Out of scope:**
- CUDA or DirectML GPU acceleration on Windows — CPU-only is the design decision for Windows
- Changes to `whisper/models.rs` — model catalog, download, and path utilities are platform-neutral and compile without the metal feature
- Any other Rust source files — only `Cargo.toml` and `engine.rs` change

---

## Architecture

Three changes across two files (plus one line in the workflow). No new files.

### Files Changed

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Split `whisper-rs` dep: base in `[dependencies]`, metal feature in `[target.'cfg(target_os = "macos")'.dependencies]` |
| `src-tauri/src/whisper/engine.rs` | Gate `ctx_params.use_gpu(true)` behind `#[cfg(target_os = "macos")]` |
| `.github/workflows/build-windows.yml` | Add `push: tags: ['v*']` trigger alongside existing `workflow_dispatch` |

---

## Files Changed

### 1. `src-tauri/Cargo.toml`

**Remove from `[dependencies]`:**
```toml
whisper-rs = { version = "0.14", features = ["metal"] }
```

**Replace with — in `[dependencies]` (ungated, all platforms):**
```toml
whisper-rs = { version = "0.14" }
```

**Add to `[target.'cfg(target_os = "macos")'.dependencies]`:**
```toml
whisper-rs = { version = "0.14", features = ["metal"] }
```

Cargo unions feature sets across `[dependencies]` and `[target.*.dependencies]` for the same crate. Result:
- macOS: `whisper-rs` compiled with `default + metal` features → Metal GPU acceleration unchanged
- Windows/Linux: `whisper-rs` compiled with `default` features only → CPU-only inference

The `[target.'cfg(target_os = "macos")'.dependencies]` section already exists in `Cargo.toml` (added in Sub-project 3 for `llama-cpp-2`). The `whisper-rs` entry is appended to it.

---

### 2. `src-tauri/src/whisper/engine.rs`

In `WhisperEngine::new()`, gate the GPU call:

**Current (lines 22–23):**
```rust
let mut ctx_params = WhisperContextParameters::default();
ctx_params.use_gpu(true);
```

**After:**
```rust
let mut ctx_params = WhisperContextParameters::default();
#[cfg(target_os = "macos")]
ctx_params.use_gpu(true);
```

On Windows and Linux, `ctx_params` stays at its default (`use_gpu = false`), so whisper runs on CPU. One line change. The rest of `engine.rs` — `WhisperContext`, `FullParams`, `WhisperContextParameters`, `transcribe()`, `apply_replacements()`, `load_wav_as_f32()` — uses no Metal-specific API and compiles without the metal feature.

---

### 3. `.github/workflows/build-windows.yml`

The Sub-project 4 workflow was intentionally `workflow_dispatch`-only because the Windows binary did not compile. Now that Sub-project 5 fixes the compile blocker, add tag-triggered builds.

**Current `on:` block:**
```yaml
on:
  workflow_dispatch:
```

**After:**
```yaml
on:
  workflow_dispatch:
  push:
    tags:
      - 'v*'
```

This triggers the Windows build automatically whenever a version tag (`v0.1.0`, `v1.0.0`, etc.) is pushed, in addition to manual dispatch.

---

## Behavior After This Change

| Scenario | Before | After |
|----------|--------|-------|
| Windows `cargo build` | Fails (Metal linker error) | Succeeds (CPU-only whisper) |
| Linux `cargo build` | Fails (Metal linker error) | Succeeds (CPU-only whisper) |
| macOS `cargo build` | Succeeds (Metal GPU) | Unchanged — Metal GPU |
| macOS transcription speed | Metal GPU | Unchanged |
| Windows transcription speed | N/A (compile failure) | CPU-only (slower than macOS Metal, functional) |
| Windows CI on `v*` tag push | Not triggered | Builds and uploads NSIS installer (requires all Sub-project 5 changes to be committed first) |

---

## Other Dependencies — Pre-verified Cross-Platform

The following dependencies in `Cargo.toml` are confirmed to compile on Windows without changes:

- **`cpal 0.15`**: Uses WASAPI on Windows by default; no extra feature flags required. The `asio` and `jack` features are optional and not used.
- **`rodio 0.19` with `default-features = false, features = ["wav"]`**: `default-features` controls audio format decoders, not the audio output backend. The cpal/WASAPI output path is always built. WAV playback works on Windows.
- **`arboard 3`**: Cross-platform clipboard library; uses Win32 clipboard API on Windows.
- **`keyring 2`**: Cross-platform keychain; uses Windows Credential Store on Windows.
- **`tauri` with `features = ["macos-private-api", ...]`**: Tauri handles `macos-private-api` as a compile-time hint internally; it does not cause a linker or compile failure on Windows.
- **`paste.rs`**: Already fully guarded with `#[cfg(target_os = "macos")]` (uses CoreGraphics/AppKit). No changes needed.
- **`rusqlite`, `chrono`, `reqwest`, `sha2`, `serde`, `tokio`, `anyhow`, `regex`, `dirs`, `uuid`, `image`, `sysinfo`**: All cross-platform, no changes needed.

After Sub-projects 2–5, `whisper-rs`'s Metal feature is the only remaining compile blocker. Fixing it produces a working Windows binary.

---

## Out of Scope

- CUDA/DirectML GPU acceleration on Windows
- Changes to `whisper/models.rs`
- Any other Rust source files
- Code signing for Windows installer
