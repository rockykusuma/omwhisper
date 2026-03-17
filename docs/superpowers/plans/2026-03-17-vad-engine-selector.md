# VAD Engine Selector Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Neural (Silero) / Energy (RMS)" selector to Settings → Audio tab so the user can switch VAD engines and compare transcription behaviour.

**Architecture:** Add `vad_engine: String` to `Settings` with serde default `"silero"`, thread it through `AudioCapture::new` to `Vad::new`, and add a two-button inline selector to the Audio tab in `Settings.tsx`.

**Tech Stack:** Rust (serde, existing `Vad`/`AudioCapture` types), React + TypeScript + Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-03-17-vad-engine-selector-design.md`

---

## Chunk 1: Rust backend

### Task 1: Add `vad_engine` to Settings

**Files:**
- Modify: `src-tauri/src/settings.rs`

---

- [ ] **Step 1: Write the failing test in `settings.rs`**

Add inside the existing `#[cfg(test)]` block (after the `default_recording_mode_is_toggle` test, following the same pattern):

```rust
#[test]
fn default_vad_engine_is_silero() {
    assert_eq!(Settings::default().vad_engine, "silero");
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test settings::tests::default_vad_engine_is_silero 2>&1
```

Expected: compile error — field `vad_engine` does not exist on `Settings`.

- [ ] **Step 3: Add the `vad_engine` field to the `Settings` struct**

In `src-tauri/src/settings.rs`, add after the `apply_polish_to_regular` field (last field in the struct, around line 101):

```rust
    /// VAD engine: "silero" (neural ONNX) | "rms" (energy threshold fallback).
    #[serde(default = "default_vad_engine")]
    pub vad_engine: String,
```

Add the default function alongside the other `default_*` functions (around line 122):

```rust
fn default_vad_engine() -> String { "silero".to_string() }
```

Add to `impl Default for Settings` (after `apply_polish_to_regular: false,`, around line 168):

```rust
            vad_engine: default_vad_engine(),
```

- [ ] **Step 4: Add `vad_engine` to `partial_json_fills_missing_fields_with_defaults`**

The existing test at line 377 asserts that old settings files (missing new fields) get correct defaults. Append one assertion after `assert_eq!(s.overlay_placement, "top-center");` and before the closing `}`:

```rust
assert_eq!(s.vad_engine, "silero");
```

- [ ] **Step 5: Run the tests**

```bash
cd src-tauri && cargo test settings 2>&1
```

Expected: all settings tests pass, including `default_vad_engine_is_silero`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/settings.rs
git commit -m "feat(settings): add vad_engine field — silero | rms, default silero"
```

---

### Task 2: Wire `vad_engine` through `Vad::new` and `AudioCapture`

**Files:**
- Modify: `src-tauri/src/audio/vad.rs`
- Modify: `src-tauri/src/audio/capture.rs`
- Modify: `src-tauri/src/commands.rs`

---

- [ ] **Step 1: Write the three failing tests in `vad.rs`**

Add inside the existing `#[cfg(test)]` block in `src-tauri/src/audio/vad.rs`, after the existing `vad_new_with_bad_model_bytes_does_not_panic` test:

```rust
#[test]
fn vad_engine_silero_loads_model() {
    // Requires the embedded silero_vad.onnx to load successfully (same dependency as lstm_state_zeroed_after_flush).
    // If ORT fails to init on a given machine, this test will fail with "expected Silero variant" — that indicates
    // an ORT/model issue, not a bug in the routing logic.
    let vad = Vad::new("silero", 0.5, 16000);
    match &vad.impl_ {
        VadImpl::Silero { .. } => {}
        VadImpl::Rms { .. } => panic!("expected Silero variant — model failed to load"),
    }
}

#[test]
fn vad_engine_rms_forces_fallback() {
    let vad = Vad::new("rms", 0.5, 16000);
    match &vad.impl_ {
        VadImpl::Rms { .. } => {}
        VadImpl::Silero { .. } => panic!("expected Rms variant"),
    }
}

#[test]
fn vad_engine_unknown_falls_back_to_rms() {
    let vad = Vad::new("unknown_engine", 0.5, 16000);
    match &vad.impl_ {
        VadImpl::Rms { .. } => {}
        VadImpl::Silero { .. } => panic!("expected Rms fallback for unknown engine"),
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd src-tauri && cargo test audio::vad::tests::vad_engine 2>&1
```

Expected: compile error — `Vad::new` called with 3 args but accepts 2.

- [ ] **Step 3: Update `Vad::new` in `vad.rs`**

In `src-tauri/src/audio/vad.rs`, replace the current `Vad::new` (around line 62):

```rust
// Before:
pub fn new(vad_sensitivity: f32, sample_rate: u32) -> Self {
    Self::from_bytes(SILERO_MODEL, vad_sensitivity, sample_rate)
}

// After:
pub fn new(vad_engine: &str, vad_sensitivity: f32, sample_rate: u32) -> Self {
    match vad_engine {
        "silero" => Self::from_bytes(SILERO_MODEL, vad_sensitivity, sample_rate),
        _        => Self::from_bytes(&[], vad_sensitivity, sample_rate),
    }
}
```

- [ ] **Step 4: Update the `silero_vad()` test helper in `vad.rs`**

The existing helper (around line 308) calls `Vad::new` with the old 2-arg signature. Update it:

```rust
// Before:
fn silero_vad() -> Vad {
    Vad::new(0.5, 16000)
}

// After:
fn silero_vad() -> Vad {
    Vad::new("silero", 0.5, 16000)
}
```

- [ ] **Step 5: Run the `vad.rs` tests to verify they pass**

```bash
cd src-tauri && cargo test audio::vad 2>&1
```

Expected: all 19 tests pass (16 existing + 3 new).

- [ ] **Step 6: Update `AudioCapture::new` in `capture.rs`**

In `src-tauri/src/audio/capture.rs`, update the `new` function (around line 19):

```rust
// Before:
pub fn new(vad_sensitivity: f32) -> Self {
    AudioCapture {
        running: Arc::new(AtomicBool::new(false)),
        vad: Arc::new(Mutex::new(Vad::new(vad_sensitivity, TARGET_SAMPLE_RATE))),
        speech_tx: Arc::new(Mutex::new(None)),
    }
}

// After:
// Note: AudioCapture::new takes (vad_sensitivity, vad_engine) — vad_sensitivity first.
// Vad::new takes (vad_engine, vad_sensitivity, sample_rate) — vad_engine first.
// The order is intentionally different; pass them correctly at the inner call site.
pub fn new(vad_sensitivity: f32, vad_engine: &str) -> Self {
    AudioCapture {
        running: Arc::new(AtomicBool::new(false)),
        vad: Arc::new(Mutex::new(Vad::new(vad_engine, vad_sensitivity, TARGET_SAMPLE_RATE))),
        speech_tx: Arc::new(Mutex::new(None)),
    }
}
```

- [ ] **Step 7: Update `commands.rs` call site**

In `src-tauri/src/commands.rs`, find the line (around line 132):

```rust
let capture = AudioCapture::new(settings.vad_sensitivity);
```

Replace with:

```rust
// AudioCapture::new signature is (vad_sensitivity, vad_engine) — sensitivity first, engine second.
let capture = AudioCapture::new(settings.vad_sensitivity, &settings.vad_engine);
```

- [ ] **Step 8: Run the full test suite**

```bash
cd src-tauri && cargo test 2>&1
```

Expected: all 120 tests pass (now 123 with the 3 new vad tests).

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/audio/vad.rs src-tauri/src/audio/capture.rs src-tauri/src/commands.rs
git commit -m "feat(vad): add vad_engine param to Vad::new and AudioCapture::new"
```

---

## Chunk 2: Frontend

### Task 3: Add VAD engine selector to Settings → Audio tab

**Files:**
- Modify: `src/components/Settings.tsx`

---

- [ ] **Step 1: Locate the VAD Sensitivity row in `Settings.tsx`**

Find the `SettingRow` with `label="VAD Sensitivity"` (around line 469). The new selector goes **above** this row, inside the same Audio tab card.

- [ ] **Step 2: Add the `vad_engine` selector**

Insert the following `SettingRow` immediately before the VAD Sensitivity row. Use this exact anchor for the insertion (insert before the `<SettingRow` that opens with `label="VAD Sensitivity"`):

```tsx
              <SettingRow
                label="VAD Sensitivity"
```

```tsx
<SettingRow label="VAD Engine" description="Neural detects speech vs noise · Energy uses volume level">
  <div className="flex rounded-xl overflow-hidden" style={{ boxShadow: "var(--nm-pressed-sm)" }}>
    {(["silero", "rms"] as const).map((engine, i) => (
      <button
        key={engine}
        onClick={() => update({ vad_engine: engine })}
        aria-pressed={settings.vad_engine === engine}
        className="text-xs px-3 py-1.5 transition-all duration-150 cursor-pointer"
        style={{
          background: settings.vad_engine === engine ? "var(--accent)" : "var(--bg)",
          color: settings.vad_engine === engine ? "#0a0f0d" : "var(--t2)",
          fontWeight: settings.vad_engine === engine ? 600 : 400,
          borderRight: i === 0 ? "1px solid color-mix(in srgb, var(--t1) 10%, transparent)" : undefined,
        }}
      >
        {engine === "silero" ? "Neural (Silero)" : "Energy (RMS)"}
      </button>
    ))}
  </div>
</SettingRow>
```

- [ ] **Step 3: Add `vad_engine` to the TypeScript type**

The `Settings` type in `Settings.tsx` is an alias: `type Settings = AppSettings`. The real interface is `AppSettings` in `src/types/index.ts`. Do **not** edit `Settings.tsx` for this step.

In `src/types/index.ts`, find the `AppSettings` interface and add after the `apply_polish_to_regular: boolean;` line (the last field):

```ts
  vad_engine: string;
```

- [ ] **Step 4: Verify the app builds**

```bash
cargo tauri dev 2>&1 | head -40
```

Expected: compiles cleanly; Settings → Audio tab shows the new "VAD Engine" row above the sensitivity slider with two buttons.

- [ ] **Step 5: Manual smoke test**

1. Open Settings → Audio tab.
2. Select "Energy (RMS)" — button highlights, sensitivity slider still visible.
3. Close Settings, start a recording, speak and stop — transcription works (RMS path).
4. Open Settings → Audio, select "Neural (Silero)" — button highlights.
5. Start a recording, speak and stop — transcription works (Silero path).
6. Quit the app, reopen — selected engine persists.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat(ui): add VAD engine selector (Neural/Energy) to Settings Audio tab"
```

---

## Acceptance Criteria

1. `cargo test` — all tests green (123+).
2. Selecting "Energy (RMS)" → `settings.vad_engine == "rms"` → `AudioCapture` creates an RMS `Vad`.
3. Selecting "Neural (Silero)" → `settings.vad_engine == "silero"` → `AudioCapture` creates a Silero `Vad`.
4. Old `settings.json` without `vad_engine` loads correctly and defaults to Silero.
5. Engine selection persists across app restarts.
