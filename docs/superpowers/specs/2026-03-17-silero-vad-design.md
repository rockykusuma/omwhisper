# Silero VAD — Design Spec
**Date:** 2026-03-17
**Branch:** `feature/silero-vad`
**Status:** Approved for implementation

---

## Problem

OmWhisper currently uses energy-based RMS VAD to detect speech. RMS measures raw volume — it cannot distinguish speech from keyboard noise, breathing, fans, or ambient room tone. When silence or non-speech noise crosses the threshold, Whisper hallucinates text ("Thank you for watching.", "You're welcome.", etc.), degrading transcription quality.

---

## Goal

Replace RMS VAD with Silero VAD — a ~1.8MB ONNX neural model that outputs per-frame speech probability. This eliminates hallucinations on silence, handles noisy environments correctly, and improves accuracy on all dictations without any user-facing change.

---

## Scope

- **In scope:** Replace `vad.rs` internals; minimal change to `capture.rs` and `commands.rs` to wire `vad_sensitivity`; bundle ONNX model; update tests.
- **Out of scope:** UI changes, new settings, Whisper engine changes.
- **Platforms:** macOS + Windows (both upgraded, no platform-specific gating).
- **Branch:** `feature/silero-vad` — merged to `main` when stable.

---

## Architecture

### Philosophy

Swap the internals of `src-tauri/src/audio/vad.rs`. The public API (`Vad::new`, `Vad::process`, `Vad::flush`, `Vad::rms`) stays identical. `capture.rs` requires one line changed to accept a `threshold` parameter. Everything else above the VAD layer is untouched.

### Model Bundling

`silero_vad.onnx` (~1.8MB) is placed in `src-tauri/assets/` and embedded at compile time:

```rust
const SILERO_MODEL: &[u8] = include_bytes!("../../assets/silero_vad.onnx");
```

No download logic, no file path resolution, no first-launch complexity. Works identically on macOS and Windows.

### Dependencies

Add to `src-tauri/Cargo.toml`:

```toml
ort = { version = "2", features = ["download-binaries"] }
ndarray = "0"   # let Cargo unify with ort's transitive ndarray version
```

`download-binaries` statically links the ONNX Runtime at compile time — no `.dylib`/`.dll` to bundle separately, no `ort::init()` call required at runtime, no Tauri resource config changes.

**Note:** After adding `ort`, run `cargo tree -i ndarray` to confirm version unification. If two `ndarray` versions appear, pin to whichever `ort` 2.x resolves to.

### `vad.rs` Internals

**Silero VAD ONNX interface (v4/v5 model):**

| Tensor | Shape | Type | Description |
|--------|-------|------|-------------|
| `input` | `[1, 512]` | f32 | Audio frame at 16kHz |
| `sr` | `[1]` | i64 | Sample rate (value: 16000) |
| `h` | `[2, 1, 64]` | f32 | LSTM hidden state input |
| `c` | `[2, 1, 64]` | f32 | LSTM cell state input |
| `output` | `[1, 1]` | f32 | Speech probability (0.0–1.0) |
| `hn` | `[2, 1, 64]` | f32 | Updated LSTM hidden state |
| `cn` | `[2, 1, 64]` | f32 | Updated LSTM cell state |

**Internal enum for fallback:**

The `Vad` struct uses an internal `VadImpl` enum so Silero-specific fields live only in the Silero variant. The `Vad::rms()` static helper lives outside the enum as it is used by `capture.rs` for the UI meter regardless of which impl is active.

```rust
enum VadImpl {
    Silero {
        session: ort::Session,
        h_state: Array3<f32>,   // [2,1,64], zeroed on utterance end/flush
        c_state: Array3<f32>,   // [2,1,64], zeroed on utterance end/flush
    },
    Rms {
        threshold: f32,         // RMS energy threshold fallback
    },
}

pub struct Vad {
    impl_: VadImpl,
    threshold: f32,                  // speech probability threshold (Silero) or energy (Rms fallback)
    sample_rate: u32,
    speech_buffer: Vec<f32>,
    silence_samples: usize,          // counted in raw samples; increments by 512 per Silero frame
    silence_timeout_samples: usize,  // = 1.5 * sample_rate
    leftover: Vec<f32>,              // partial frame buffer for Silero (<512 samples); unused for Rms
}
```

**Sensitivity mapping:**

`vad_sensitivity` (0.0–1.0, default 0.5) maps to speech probability threshold:
```
threshold = 1.0 - vad_sensitivity
```
Default sensitivity 0.5 → threshold 0.5. Higher sensitivity → lower threshold → detects softer speech.

`DEFAULT_THRESHOLD` in `vad.rs` is updated to `0.5` (correct Silero default). Its meaning changes from "RMS energy" to "speech probability threshold".

**`Vad::new()` and `Vad::from_bytes()` (for testability):**

```rust
// Public constructor — loads from embedded SILERO_MODEL bytes
pub fn new(threshold: f32, sample_rate: u32) -> Self {
    Self::from_bytes(SILERO_MODEL, threshold, sample_rate)
}

// Internal constructor — accepts model bytes, enables testing with bad/empty bytes
pub(crate) fn from_bytes(model_bytes: &[u8], threshold: f32, sample_rate: u32) -> Self {
    let impl_ = match ort::Session::builder()
        .and_then(|b| b.commit_from_memory(model_bytes))
    {
        Ok(session) => VadImpl::Silero {
            session,
            h_state: Array3::zeros([2, 1, 64]),
            c_state: Array3::zeros([2, 1, 64]),
        },
        Err(e) => {
            tracing::error!("Silero VAD init failed, falling back to RMS VAD: {e}");
            VadImpl::Rms { threshold }
        }
    };
    Vad { impl_, threshold, sample_rate, ... }
}
```

`from_bytes` is `pub(crate)` so tests in the same crate can inject empty/corrupt bytes without exposing it as public API.

**`process()` logic (Silero path):**
1. Append incoming samples to `leftover`
2. While `leftover.len() >= 512`: extract a 512-sample frame
3. Run ONNX inference with `input`, `sr=16000`, current `h_state`, `c_state`
4. Update `h_state = hn`, `c_state = cn` from inference output
5. If `prob >= threshold`: accumulate frame into `speech_buffer`, reset `silence_samples = 0`
6. If `prob < threshold` and `speech_buffer` is non-empty: `silence_samples += 512`
7. If `silence_samples >= silence_timeout_samples`: take `speech_buffer`, reset `h_state` and `c_state` to `Array3::zeros([2, 1, 64])`, reset `silence_samples = 0`, return `Some(utterance)`
8. Return `None` if no utterance completed

**`process()` logic (Rms fallback path):** identical to current RMS implementation. The `leftover` buffer is bypassed entirely — samples are passed directly to the energy threshold check without frame buffering.

**`flush()` logic:**
Resets all state completely:
- If `speech_buffer` is empty → return `None`
- Otherwise: take `speech_buffer`, clear `leftover`, reset `silence_samples = 0`, reset `h_state` and `c_state` to `Array3::zeros([2, 1, 64])` (Silero path only), return `Some(utterance)`
- Any sub-frame samples sitting in `leftover` (fewer than 512 samples, Silero path only) are intentionally discarded. They represent a partial frame at the tail of speech and are too short to run inference on.

**`rms()` helper:**
Kept as a `pub` static method — used by `capture.rs` for the frontend audio level meter. Not involved in VAD decisions. Module doc comment updated to reflect this.

### Wiring `vad_sensitivity` — Minimal `capture.rs` Change

`AudioCapture::new()` in `capture.rs` currently hardcodes `DEFAULT_THRESHOLD`:

```rust
vad: Arc::new(Mutex::new(Vad::new(DEFAULT_THRESHOLD, TARGET_SAMPLE_RATE))),
```

Change `AudioCapture::new()` to accept a `threshold` parameter:

```rust
pub fn new(threshold: f32) -> Self {
    AudioCapture {
        vad: Arc::new(Mutex::new(Vad::new(threshold, TARGET_SAMPLE_RATE))),
        ...
    }
}
```

In `commands.rs`, `start_transcription` reads settings and passes the sensitivity:

```rust
let settings = load_settings_sync();
let capture = AudioCapture::new(settings.vad_sensitivity);
```

This is the **only change to `capture.rs`**: one line in `AudioCapture::new()` and its signature. The `DEFAULT_THRESHOLD` import from `vad.rs` is no longer needed in `capture.rs`.

---

## File Changes

| File | Change |
|------|--------|
| `src-tauri/assets/silero_vad.onnx` | Add — bundled model |
| `src-tauri/Cargo.toml` | Add `ort` + `ndarray` dependencies |
| `src-tauri/src/audio/vad.rs` | Rewrite internals; keep public API; add `from_bytes`; update doc comments |
| `src-tauri/src/audio/capture.rs` | `AudioCapture::new(threshold: f32)` — one line changed |
| `src-tauri/src/commands.rs` | Pass `settings.vad_sensitivity` to `AudioCapture::new()` |

**Unchanged:** `lib.rs`, `settings.rs`, all frontend files.

---

## Testing

### Unit tests in `vad.rs`

| Test | Description |
|------|-------------|
| `silence_returns_none` | Feed pure silence frames → no utterance returned |
| `speech_accumulates` | Feed speech-level frames → accumulates, returns None |
| `utterance_flushed_after_silence_timeout` | Speech then silence → utterance returned after timeout |
| `lstm_state_reset_after_utterance` | After utterance returned, h/c state arrays are all zeros |
| `flush_returns_buffered_speech` | `flush()` on non-empty buffer returns samples |
| `flush_clears_all_state` | After flush: speech_buffer, leftover, silence_samples, h/c all zeroed; second flush returns None |
| `rms_helper_unchanged` | `Vad::rms()` still computes correctly |
| `sensitivity_threshold_mapping` | `vad_sensitivity=1.0` → threshold=0.0; `vad_sensitivity=0.0` → threshold=1.0 |
| `vad_new_with_bad_model_falls_back` | `Vad::from_bytes(&[], 0.5, 16000)` does not panic; returned Vad processes audio via RMS fallback |

### Integration
- All existing `commands.rs` tests pass (one call site updated)
- All existing `capture.rs` tests pass (signature updated)
- Full `cargo test` suite green on macOS before merge
- Windows build green via CI (`build-windows.yml`)

---

## Success Criteria

1. `cargo test` fully green on macOS and Windows
2. Whisper hallucinations on silence eliminated in manual testing
3. No regressions in normal dictation accuracy
4. ONNX model contribution to app size ≤ 2MB (note: `ort` static library adds ~8–12MB on top of this, which is acceptable)
5. `capture.rs` diff is exactly one line changed (signature of `AudioCapture::new`)
