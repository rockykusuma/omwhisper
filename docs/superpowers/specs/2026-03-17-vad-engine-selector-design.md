# VAD Engine Selector — Design Spec
**Date:** 2026-03-17
**Branch:** `feature/silero-vad`
**Status:** Approved for implementation

---

## Problem

Silero VAD (neural, recently implemented) and RMS VAD (energy-based, original) have different trade-offs. The user wants to switch between them in the app to compare their behaviour on real dictation sessions and decide which to keep.

---

## Goal

Add a segmented control to Settings → Audio tab that lets the user select the active VAD engine. Persisted to settings. Takes effect on the next recording session.

---

## Scope

- **In scope:** `vad_engine` setting; wire through `AudioCapture` and `Vad::new`; segmented control in Audio tab UI.
- **Out of scope:** Real-time switching mid-session, diagnostic logging, probability visualisation.
- **Branch:** `feature/silero-vad` — already contains both VAD implementations.

---

## Architecture

### Settings

Add one field to `Settings` in `settings.rs`:

```rust
pub vad_engine: String,  // "silero" | "rms"
```

Default: `"silero"`.

Serialised/deserialised via the existing `serde` derive. No migration needed — missing field falls back to the `serde(default)` value.

### Vad internals

`Vad::from_bytes(&[], ...)` already forces the RMS fallback (empty bytes → Silero session init fails → RMS). Expose this as a first-class option by routing through `Vad::new`:

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

`AudioCapture::new` currently accepts `vad_sensitivity: f32`. Add `vad_engine: &str`:

```rust
pub fn new(vad_sensitivity: f32, vad_engine: &str) -> Self {
    AudioCapture {
        vad: Arc::new(Mutex::new(Vad::new(vad_engine, vad_sensitivity, TARGET_SAMPLE_RATE))),
        ...
    }
}
```

### commands.rs

One additional argument in `start_transcription`:

```rust
let capture = AudioCapture::new(settings.vad_sensitivity, &settings.vad_engine);
```

### UI — Settings → Audio tab

A segmented control labelled **"VAD Engine"**, placed above or below the existing VAD sensitivity slider:

```
VAD Engine
[  Neural (Silero)  |  Energy (RMS)  ]
```

Uses the same two-option segmented control pattern as the recording mode selector (Toggle / Push to Talk). Calls `updateSettings({ vad_engine: "silero" | "rms" })` on change. No restart required — takes effect on the next recording session.

---

## File Changes

| File | Change |
|------|--------|
| `src-tauri/src/settings.rs` | Add `vad_engine: String` field with default `"silero"` |
| `src-tauri/src/audio/vad.rs` | Add `vad_engine` param to `Vad::new`; route to `from_bytes` accordingly |
| `src-tauri/src/audio/capture.rs` | Add `vad_engine: &str` param to `AudioCapture::new` |
| `src-tauri/src/commands.rs` | Pass `settings.vad_engine` to `AudioCapture::new` |
| `src/components/Settings.tsx` | Add segmented control for `vad_engine` in Audio tab |

**Unchanged:** `lib.rs`, `history.rs`, all other frontend files, `Cargo.toml`.

---

## Testing

| Test | Description |
|------|-------------|
| `vad_engine_silero_loads_model` | `Vad::new("silero", 0.5, 16000)` → `VadImpl::Silero` variant |
| `vad_engine_rms_forces_fallback` | `Vad::new("rms", 0.5, 16000)` → `VadImpl::Rms` variant |
| `vad_engine_unknown_falls_back_to_rms` | `Vad::new("unknown", 0.5, 16000)` → `VadImpl::Rms` variant (safe default) |
| Settings default | `Settings::default().vad_engine == "silero"` |
| Existing 120 tests | All pass unchanged |
