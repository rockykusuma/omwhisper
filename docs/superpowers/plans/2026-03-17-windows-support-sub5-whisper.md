# whisper-rs Windows Build Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `whisper-rs` compile on Windows by splitting its Metal GPU feature into a macOS-only target dependency, keeping Metal GPU acceleration on macOS while using CPU-only inference on Windows/Linux.

**Architecture:** Two Rust file changes and one YAML change. `Cargo.toml` keeps a base `whisper-rs` entry (no Metal) in `[dependencies]` and adds a Metal-featured entry in the existing `[target.'cfg(target_os = "macos")'.dependencies]` section — Cargo unions the feature sets. `engine.rs` gates `ctx_params.use_gpu(true)` behind `#[cfg(target_os = "macos")]`. The GitHub Actions workflow gains a `push: tags: ['v*']` trigger now that the Windows binary will compile.

**Tech Stack:** Rust/Cargo (feature gating, target-conditional dependencies), `whisper-rs 0.14`, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-03-17-windows-support-sub5-whisper-design.md`

---

## Chunk 1: All Changes

### Task 1: Split whisper-rs Metal feature in Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml:33` (remove metal from base dep)
- Modify: `src-tauri/Cargo.toml:57-58` (append whisper-rs to macOS target section)

**Context:** `Cargo.toml` currently has `whisper-rs = { version = "0.14", features = ["metal"] }` on line 33 in `[dependencies]`. This causes a Metal linker error on Windows. The `[target.'cfg(target_os = "macos")'.dependencies]` section already exists at lines 57–58 (containing `llama-cpp-2`). Cargo unions feature sets when the same crate appears in both sections.

**IMPORTANT:** Add a comment above the macOS whisper-rs entry so future maintainers don't "clean up" the apparent duplicate and break Windows builds.

- [ ] **Step 1: Replace the whisper-rs line in `[dependencies]`**

In `src-tauri/Cargo.toml`, find line 33:
```toml
whisper-rs = { version = "0.14", features = ["metal"] }
```

Replace with:
```toml
whisper-rs = { version = "0.14" }
```

- [ ] **Step 2: Append whisper-rs to the macOS target section**

Find the `[target.'cfg(target_os = "macos")'.dependencies]` section (currently lines 57–58):
```toml
[target.'cfg(target_os = "macos")'.dependencies]
llama-cpp-2 = { version = "0.1.138", features = ["metal"] }
```

Replace with:
```toml
[target.'cfg(target_os = "macos")'.dependencies]
llama-cpp-2 = { version = "0.1.138", features = ["metal"] }
# whisper-rs base dep is in [dependencies] (CPU-only, all platforms).
# This entry adds the Metal GPU feature on macOS only. Cargo unions both.
# Do NOT remove the base entry from [dependencies] — that would break Windows.
whisper-rs = { version = "0.14", features = ["metal"] }
```

- [ ] **Step 3: Verify cargo check passes on macOS**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo check
```

Expected: `Finished` with no errors. (Warnings about unused imports or dead code are fine.)

- [ ] **Step 4: Verify cargo test passes**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo test 2>&1 | tail -5
```

Expected: `test result: ok.` with 0 failures.

- [ ] **Step 5: Commit**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper
git add src-tauri/Cargo.toml
git commit -m "feat: gate whisper-rs metal feature to macOS only"
```

---

### Task 2: Gate use_gpu(true) in engine.rs

**Files:**
- Modify: `src-tauri/src/whisper/engine.rs:23`

**Context:** `WhisperEngine::new()` calls `ctx_params.use_gpu(true)` unconditionally. On Windows/Linux without the `metal` feature, this call still compiles (it's a setter on `WhisperContextParameters`) but has no effect — whisper-rs will ignore it and fall back to CPU. However, gating it with `#[cfg(target_os = "macos")]` is the correct approach per the spec: it makes the intent explicit and avoids any future confusion about why GPU is being requested on a platform that doesn't support it.

- [ ] **Step 1: Gate the use_gpu call**

In `src-tauri/src/whisper/engine.rs`, find lines 22–23:
```rust
        let mut ctx_params = WhisperContextParameters::default();
        ctx_params.use_gpu(true);
```

Replace with:
```rust
        let mut ctx_params = WhisperContextParameters::default();
        #[cfg(target_os = "macos")]
        ctx_params.use_gpu(true);
```

The `#[cfg]` attribute applies to the single statement that follows it. No braces needed.

- [ ] **Step 2: Verify cargo check passes**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo check
```

Expected: `Finished` with no errors.

- [ ] **Step 3: Verify cargo test passes**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo test 2>&1 | tail -5
```

Expected: `test result: ok.` with 0 failures.

- [ ] **Step 4: Commit**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper
git add src-tauri/src/whisper/engine.rs
git commit -m "feat: gate whisper use_gpu(true) to macOS only"
```

---

### Task 3: Add tag trigger to GitHub Actions Windows workflow

**Files:**
- Modify: `.github/workflows/build-windows.yml:3-4`

**Context:** The workflow currently only has `workflow_dispatch` (manual). Now that whisper-rs compiles on Windows, add `push: tags: ['v*']` so the workflow also runs automatically when a version tag is pushed. This was explicitly planned in the Sub-project 4 spec as a one-line post-Sub5 addition.

- [ ] **Step 1: Add push trigger to workflow**

In `.github/workflows/build-windows.yml`, find lines 3–4:
```yaml
on:
  workflow_dispatch:
```

Replace with:
```yaml
on:
  workflow_dispatch:
  push:
    tags:
      - 'v*'
```

- [ ] **Step 2: Validate YAML structure**

```bash
python3 -c "
import sys
content = open('/Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/.github/workflows/build-windows.yml').read()
assert 'workflow_dispatch' in content
assert \"tags:\" in content
assert \"'v*'\" in content
print('YAML structure check passed')
"
```

Expected: `YAML structure check passed`

- [ ] **Step 3: Run cargo check one final time**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo check
```

Expected: `Finished` with no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper
git add .github/workflows/build-windows.yml
git commit -m "feat: trigger Windows CI build on version tag push"
```
