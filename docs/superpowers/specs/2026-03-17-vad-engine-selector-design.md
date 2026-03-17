# VAD Engine Selector — Design Spec
**Date:** 2026-03-17
**Branch:** `feature/silero-vad`
**Status:** Approved for implementation

---

## Problem

Silero VAD (neural, recently implemented) and RMS VAD (energy-based, original) have different trade-offs. The user wants to switch between them in the app to compare their behaviour on real dictation sessions and decide which to keep.

---

## Goal

Add a two-button inline selector to Settings → Audio tab that lets the user select the active VAD engine. Persisted to settings. Takes effect on the next recording session.

---

## Scope

- **In scope:** `vad_engine` setting; wire through `AudioCapture` and `Vad::new`; inline button selector in Audio tab UI.
- **Out of scope:** Real-time switching mid-session, diagnostic logging, probability visualisation.
- **Branch:** `feature/silero-vad` — already contains both VAD implementations.

---

## Architecture

### Settings

Add one field to `Settings` in `settings.rs`, following the exact pattern used by `recording_mode` and `ai_backend`:

```rust
#[serde(default = "default_vad_engine")]
pub vad_engine: String,  // "silero" | "rms"
```

Add the default function (alongside the other `default_*` functions in `settings.rs`):

```rust
fn default_vad_engine() -> String { "silero".to_string() }
```

Add to `impl Default for Settings`:

```rust
vad_engine: default_vad_engine(),
```

`#[serde(default = "default_vad_engine")]` is required — `#[serde(default)]` alone on a `String` field would produce `""`, which would silently fall through to the RMS `_` arm in `Vad::new`. Old settings files without this key will correctly deserialise as `"silero"`.

### Vad internals

`Vad::from_bytes(&[], ...)` already forces the RMS fallback (empty bytes → Silero session init fails → RMS). Expose this as a first-class option by updating `Vad::new` to accept a `vad_engine` parameter:

```rust
pub fn new(vad_engine: &str, vad_sensitivity: f32, sample_rate: u32) -> Self {
    match vad_engine {
        "silero" => Self::from_bytes(SILERO_MODEL, vad_sensitivity, sample_rate),
        _        => Self::from_bytes(&[], vad_sensitivity, sample_rate),
    }
}
```

No new code paths or structs required.

### AudioCapture wiring

`AudioCapture::new` currently accepts `vad_sensitivity: f32`. Add `vad_engine: &str` and update the internal `Vad::new` call to pass it:

```rust
pub fn new(vad_sensitivity: f32, vad_engine: &str) -> Self {
    AudioCapture {
        vad: Arc::new(Mutex::new(Vad::new(vad_engine, vad_sensitivity, TARGET_SAMPLE_RATE))),
        ...
    }
}
```

Note: the inner `Vad::new(...)` call must be updated to pass `vad_engine` as the first argument — the current call is `Vad::new(vad_sensitivity, TARGET_SAMPLE_RATE)` and must become `Vad::new(vad_engine, vad_sensitivity, TARGET_SAMPLE_RATE)`.

### commands.rs

One additional argument in `start_transcription`:

```rust
let capture = AudioCapture::new(settings.vad_sensitivity, &settings.vad_engine);
```

### UI — Settings → Audio tab

A two-button inline group labelled **"VAD Engine"**, placed above or below the existing VAD sensitivity slider. There is no existing `SegmentedControl` component — implement as two adjacent `<button>` elements styled with Tailwind, matching the visual style of other inline selectors in the settings panel (e.g., `rounded-l-lg` / `rounded-r-lg` border grouping):

```
VAD Engine
[  Neural (Silero)  |  Energy (RMS)  ]
```

Calls `updateSettings({ vad_engine: "silero" | "rms" })` on change. No restart required — takes effect on the next recording session.

---

## File Changes

| File | Change |
|------|--------|
| `src-tauri/src/settings.rs` | Add `#[serde(default = "default_vad_engine")]` field, `default_vad_engine()` function, and `Default` impl entry |
| `src-tauri/src/audio/vad.rs` | Add `vad_engine: &str` as first param to `Vad::new`; route to `from_bytes` accordingly |
| `src-tauri/src/audio/capture.rs` | Add `vad_engine: &str` param to `AudioCapture::new`; update internal `Vad::new` call to pass it |
| `src-tauri/src/commands.rs` | Pass `&settings.vad_engine` to `AudioCapture::new` |
| `src/components/Settings.tsx` | Add two-button inline selector for `vad_engine` in Audio tab |

**Unchanged:** `lib.rs`, `history.rs`, all other frontend files, `Cargo.toml`.

---

## Testing

The three `vad_engine_*` tests live inside the existing `#[cfg(test)]` block in `vad.rs`. They access `vad.impl_` directly via `match &vad.impl_` — valid because tests are in the same module and `VadImpl` is private. The `settings_default_vad_engine_is_silero` test lives in the existing `#[cfg(test)]` block in `settings.rs`.

| Test | File | Description |
|------|------|-------------|
| `vad_engine_silero_loads_model` | `vad.rs` | `Vad::new("silero", 0.5, 16000)` → `VadImpl::Silero` variant |
| `vad_engine_rms_forces_fallback` | `vad.rs` | `Vad::new("rms", 0.5, 16000)` → `VadImpl::Rms` variant |
| `vad_engine_unknown_falls_back_to_rms` | `vad.rs` | `Vad::new("unknown", 0.5, 16000)` → `VadImpl::Rms` variant (safe default) |
| `settings_default_vad_engine_is_silero` | `settings.rs` | `Settings::default().vad_engine == "silero"` |

**Companion change — existing test helper:** The `silero_vad()` helper in `vad.rs` currently calls `Vad::new(0.5, 16000)` (old 2-argument signature). After adding `vad_engine` as the first argument to `Vad::new`, this call must be updated to `Vad::new("silero", 0.5, 16000)` or the crate will not compile.

---

## Acceptance Criteria

1. All 120 existing `cargo test` tests pass unchanged.
2. Selecting "Energy (RMS)" in Settings → Audio and recording dictation uses RMS VAD.
3. Selecting "Neural (Silero)" in Settings → Audio and recording dictation uses Silero VAD.
4. An old `settings.json` without a `vad_engine` key loads correctly and defaults to Silero.
