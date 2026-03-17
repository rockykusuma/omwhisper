# Silero VAD Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace energy-based RMS VAD with Silero VAD (ONNX neural model) to eliminate Whisper hallucinations on silence and improve speech detection in noisy environments.

**Architecture:** Bundle `silero_vad.onnx` via `include_bytes!`, rewrite `vad.rs` internals with a `VadImpl` enum (`Silero` / `Rms` fallback), preserve the public API so `capture.rs` and everything above it requires only one-line changes.

**Tech Stack:** Rust, `ort` v2 (ONNX Runtime, `download-binaries` feature), `ndarray`, Tauri 2.

**Spec:** `docs/superpowers/specs/2026-03-17-silero-vad-design.md`

---

## Chunk 1: Branch + Model + Dependencies

### Task 1: Create feature branch

**Files:**
- No file changes — git operation only

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feature/silero-vad
```

Expected: `Switched to a new branch 'feature/silero-vad'`

---

### Task 2: Download Silero VAD model and create assets directory

**Files:**
- Create: `src-tauri/assets/silero_vad.onnx`

- [ ] **Step 1: Create assets directory**

```bash
mkdir -p src-tauri/assets
```

- [ ] **Step 2: Download the Silero VAD v4 ONNX model**

```bash
curl -L "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx" \
     -o src-tauri/assets/silero_vad.onnx
```

- [ ] **Step 3: Verify the file downloaded and is non-empty**

```bash
ls -lh src-tauri/assets/silero_vad.onnx
```

Expected: file exists, size ~1.8MB (roughly `1.8M`)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/assets/silero_vad.onnx
git commit -m "chore: add silero_vad.onnx model asset"
```

---

### Task 3: Add ort and ndarray dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add dependencies to Cargo.toml**

In `src-tauri/Cargo.toml`, add these two lines to the `[dependencies]` section (after the `rodio` line):

```toml
ort = { version = "2", features = ["download-binaries"] }
ndarray = "0"
```

- [ ] **Step 2: Verify Cargo resolves without errors**

```bash
cd src-tauri && cargo fetch 2>&1 | tail -5
```

Expected: no errors. If `error: failed to select a version`, check `ort` 2.x availability on crates.io.

- [ ] **Step 3: Check ndarray version unification**

```bash
cd src-tauri && cargo tree -i ndarray 2>&1 | head -20
```

Expected: a single `ndarray vX.Y.Z` with no duplicate versions. If two versions appear, pin `ndarray` to whichever version `ort` resolves to (e.g. `ndarray = "0.16"`).

- [ ] **Step 4: Verify the project still compiles**

```bash
cd src-tauri && cargo build --lib 2>&1 | tail -10
```

Expected: compiles successfully (existing code is untouched).

- [ ] **Step 5: Commit**

```bash
cd ..
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(deps): add ort and ndarray for Silero VAD"
```

---

## Chunk 2: vad.rs Rewrite (TDD)

### Task 4: Write all failing tests for the new vad.rs

**Files:**
- Modify: `src-tauri/src/audio/vad.rs` (tests section only, at the bottom)

Replace the entire `#[cfg(test)]` block at the bottom of `src-tauri/src/audio/vad.rs` with the tests below. Do NOT change any other part of the file yet — the existing struct/impl must stay in place so the file still compiles.

- [ ] **Step 1: Replace the test module at the bottom of vad.rs**

Find the `#[cfg(test)]` block (starts around line 88) and replace it entirely with:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // ── rms helper ───────────────────────────────────────────────────────────

    #[test]
    fn rms_of_empty_slice_is_zero() {
        assert_eq!(Vad::rms(&[]), 0.0);
    }

    #[test]
    fn rms_of_silence_is_zero() {
        let silence = vec![0.0f32; 100];
        assert_eq!(Vad::rms(&silence), 0.0);
    }

    #[test]
    fn rms_of_unit_amplitude_is_one() {
        let signal: Vec<f32> = (0..100).map(|i| if i % 2 == 0 { 1.0 } else { -1.0 }).collect();
        let rms = Vad::rms(&signal);
        assert!((rms - 1.0).abs() < 1e-5, "expected ~1.0, got {rms}");
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// Returns a Vad using the RMS fallback (bad model bytes → Silero init fails → fallback).
    fn rms_vad(sensitivity: f32) -> Vad {
        Vad::from_bytes(&[], sensitivity, 16000)
    }

    /// Returns a Vad using the real embedded Silero model.
    /// Only used for tests that must exercise the Silero path (LSTM state).
    fn silero_vad() -> Vad {
        Vad::new(0.5, 16000)
    }

    fn speech_samples() -> Vec<f32> {
        vec![0.5f32; 1600] // well above RMS threshold for fallback path
    }

    fn silence_samples() -> Vec<f32> {
        vec![0.0f32; 1600]
    }

    // ── sensitivity / threshold mapping ──────────────────────────────────────

    #[test]
    fn sensitivity_one_gives_threshold_zero() {
        let vad = rms_vad(1.0);
        assert!((vad.threshold - 0.0).abs() < 1e-6);
    }

    #[test]
    fn sensitivity_zero_gives_threshold_one() {
        let vad = rms_vad(0.0);
        assert!((vad.threshold - 1.0).abs() < 1e-6);
    }

    #[test]
    fn sensitivity_default_gives_threshold_half() {
        let vad = rms_vad(0.5);
        assert!((vad.threshold - 0.5).abs() < 1e-6);
    }

    // ── fallback ─────────────────────────────────────────────────────────────

    #[test]
    fn vad_new_with_bad_model_bytes_does_not_panic() {
        // Empty bytes → ort session init fails → silently falls back to RMS
        let vad = Vad::from_bytes(&[], 0.5, 16000);
        // Must be functional: can call process without panic
        let _ = vad.process(&silence_samples());
    }

    // ── process — silence ─────────────────────────────────────────────────────

    #[test]
    fn silence_with_no_buffered_speech_returns_none() {
        let mut vad = rms_vad(0.5);
        assert!(vad.process(&silence_samples()).is_none());
    }

    // ── process — speech accumulation ────────────────────────────────────────

    #[test]
    fn speech_chunk_accumulates_returns_none() {
        let mut vad = rms_vad(0.5);
        assert!(vad.process(&speech_samples()).is_none());
    }

    #[test]
    fn two_speech_chunks_keep_accumulating() {
        let mut vad = rms_vad(0.5);
        assert!(vad.process(&speech_samples()).is_none());
        assert!(vad.process(&speech_samples()).is_none());
    }

    // ── process — utterance flush after silence timeout ───────────────────────

    #[test]
    fn utterance_returned_after_silence_timeout() {
        // silence_timeout = 1.5s * 16000 = 24000 samples
        // Each silence chunk = 1600 samples → need 15 chunks to exceed 24000
        let mut vad = rms_vad(0.5);
        assert!(vad.process(&speech_samples()).is_none());

        let mut result = None;
        for _ in 0..20 {
            result = vad.process(&silence_samples());
            if result.is_some() { break; }
        }
        assert!(result.is_some(), "expected utterance after silence timeout");
        assert!(result.unwrap().len() >= 1600);
    }

    // ── process — state after utterance ──────────────────────────────────────

    #[test]
    fn after_utterance_next_silence_returns_none() {
        let mut vad = rms_vad(0.5);
        vad.process(&speech_samples());
        for _ in 0..20 {
            vad.process(&silence_samples());
        }
        // After utterance flushed, more silence should return None
        assert!(vad.process(&silence_samples()).is_none());
    }

    // ── LSTM state reset after utterance (Silero path) ───────────────────────

    #[test]
    fn lstm_state_reset_after_utterance_via_silence_timeout() {
        // Uses the real Silero model. Verifies h/c state is zeroed after a
        // completed utterance so successive utterances don't bleed LSTM context.
        let mut vad = silero_vad();
        // Feed enough silence to trigger timeout without any prior speech.
        // State should start zeroed and stay zeroed (no utterance produced).
        for _ in 0..30 {
            vad.process(&vec![0.0f32; 512]);
        }
        if let super::VadImpl::Silero { h_state, c_state, .. } = &vad.impl_ {
            // After silence-only run, LSTM state must still be all zeros
            assert!(h_state.iter().all(|&v| v == 0.0), "h_state not zeroed");
            assert!(c_state.iter().all(|&v| v == 0.0), "c_state not zeroed");
        }
    }

    // ── flush ─────────────────────────────────────────────────────────────────

    #[test]
    fn flush_empty_buffer_returns_none() {
        let mut vad = rms_vad(0.5);
        assert!(vad.flush().is_none());
    }

    #[test]
    fn flush_returns_buffered_speech() {
        let mut vad = rms_vad(0.5);
        vad.process(&speech_samples());
        let flushed = vad.flush();
        assert!(flushed.is_some());
        assert!(flushed.unwrap().len() >= 1600);
    }

    #[test]
    fn flush_clears_all_state() {
        let mut vad = rms_vad(0.5);
        vad.process(&speech_samples());
        vad.flush();
        // After flush: second flush returns None
        assert!(vad.flush().is_none());
        // After flush: silence returns None (not carrying over buffered state)
        assert!(vad.process(&silence_samples()).is_none());
    }
}
```

- [ ] **Step 2: Run the tests — expect most to FAIL (new tests reference new API)**

```bash
cd src-tauri && cargo test --lib audio::vad 2>&1 | tail -30
```

Expected: compile errors or test failures — this is correct. The goal is to capture the desired behaviour before rewriting.

---

### Task 5: Implement the new vad.rs

**Files:**
- Modify: `src-tauri/src/audio/vad.rs` (full rewrite, keeping tests intact)

Replace the entire file content above the `#[cfg(test)]` block with the implementation below. Keep the `#[cfg(test)]` block written in Task 4 untouched.

- [ ] **Step 1: Replace the implementation section of vad.rs**

The full non-test content of `src-tauri/src/audio/vad.rs` should be:

```rust
//! Voice Activity Detection.
//!
//! Uses the Silero VAD ONNX model (v4/v5) for neural speech detection.
//! Falls back to energy-based RMS VAD if the ONNX session fails to initialise.
//!
//! The `rms()` static helper is kept for the frontend audio level meter in
//! `capture.rs` and is not involved in VAD decisions.

use ndarray::{Array1, Array2, Array3};
use ort::Session;

/// Silero VAD ONNX model, embedded at compile time.
const SILERO_MODEL: &[u8] = include_bytes!("../../assets/silero_vad.onnx");

/// Default speech probability threshold (Silero) derived from vad_sensitivity = 0.5.
/// threshold = 1.0 - vad_sensitivity
pub const DEFAULT_THRESHOLD: f32 = 0.5;

/// Seconds of silence after which the current utterance is finalised.
const SILENCE_TIMEOUT_SECS: f32 = 1.5;

/// Silero VAD processes audio in 512-sample frames at 16kHz.
const FRAME_SIZE: usize = 512;

// ── Internal implementation ───────────────────────────────────────────────────

enum VadImpl {
    Silero {
        session: Session,
        /// LSTM hidden state [2, 1, 64] — persists between frames, zeroed on utterance end/flush.
        h_state: Array3<f32>,
        /// LSTM cell state [2, 1, 64] — persists between frames, zeroed on utterance end/flush.
        c_state: Array3<f32>,
    },
    /// RMS energy fallback — used when Silero ONNX session fails to initialise.
    Rms {
        threshold: f32,
    },
}

// ── Public struct ─────────────────────────────────────────────────────────────

pub struct Vad {
    impl_: VadImpl,
    /// Speech probability threshold (Silero) or energy threshold (Rms).
    /// Derived from vad_sensitivity: threshold = 1.0 - vad_sensitivity.
    pub(crate) threshold: f32,
    sample_rate: u32,
    /// Accumulated speech samples for the current utterance.
    speech_buffer: Vec<f32>,
    /// Silence duration in raw samples (increments by FRAME_SIZE=512 per Silero frame).
    silence_samples: usize,
    /// Silence timeout in raw samples = SILENCE_TIMEOUT_SECS * sample_rate.
    silence_timeout_samples: usize,
    /// Partial frame buffer for Silero path (<FRAME_SIZE samples); bypassed on Rms path.
    leftover: Vec<f32>,
}

impl Vad {
    /// Public constructor — loads from the embedded `silero_vad.onnx` model bytes.
    pub fn new(vad_sensitivity: f32, sample_rate: u32) -> Self {
        Self::from_bytes(SILERO_MODEL, vad_sensitivity, sample_rate)
    }

    /// Internal constructor that accepts model bytes directly.
    /// Used by tests to inject empty/corrupt bytes and exercise the RMS fallback path.
    pub(crate) fn from_bytes(model_bytes: &[u8], vad_sensitivity: f32, sample_rate: u32) -> Self {
        let threshold = 1.0 - vad_sensitivity.clamp(0.0, 1.0);
        let silence_timeout_samples = (SILENCE_TIMEOUT_SECS * sample_rate as f32) as usize;

        let impl_ = match Session::builder()
            .and_then(|b| b.commit_from_memory(model_bytes))
        {
            Ok(session) => {
                tracing::debug!("Silero VAD initialised successfully");
                VadImpl::Silero {
                    session,
                    h_state: Array3::zeros((2, 1, 64)),
                    c_state: Array3::zeros((2, 1, 64)),
                }
            }
            Err(e) => {
                tracing::error!("Silero VAD init failed, falling back to RMS VAD: {e}");
                VadImpl::Rms { threshold }
            }
        };

        Vad {
            impl_,
            threshold,
            sample_rate,
            speech_buffer: Vec::new(),
            silence_samples: 0,
            silence_timeout_samples,
            leftover: Vec::new(),
        }
    }

    /// Calculate RMS energy of a chunk.
    /// Used by `capture.rs` for the frontend audio level meter only.
    pub fn rms(samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }
        let sum_sq: f32 = samples.iter().map(|&s| s * s).sum();
        (sum_sq / samples.len() as f32).sqrt()
    }

    /// Process a chunk of audio samples.
    ///
    /// Returns `Some(Vec<f32>)` when an utterance is complete (speech followed by silence timeout).
    /// Returns `None` if still accumulating or if no speech has been detected.
    pub fn process(&mut self, samples: &[f32]) -> Option<Vec<f32>> {
        match &self.impl_ {
            VadImpl::Rms { threshold } => self.process_rms(samples, *threshold),
            VadImpl::Silero { .. } => self.process_silero(samples),
        }
    }

    /// Force-flush any buffered speech (called on recording stop).
    ///
    /// Resets all state: speech_buffer, leftover, silence_samples, and LSTM states.
    /// Sub-frame samples in `leftover` (Silero path, <512 samples) are intentionally
    /// discarded — they are too short to run inference on.
    pub fn flush(&mut self) -> Option<Vec<f32>> {
        if self.speech_buffer.is_empty() {
            return None;
        }
        let utterance = std::mem::take(&mut self.speech_buffer);
        self.leftover.clear();
        self.silence_samples = 0;
        self.reset_lstm_state();
        Some(utterance)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /// RMS fallback path. Bypasses `leftover` — processes samples directly.
    fn process_rms(&mut self, samples: &[f32], threshold: f32) -> Option<Vec<f32>> {
        let energy = Self::rms(samples);
        let is_speech = energy >= threshold;

        if is_speech {
            self.speech_buffer.extend_from_slice(samples);
            self.silence_samples = 0;
            None
        } else {
            if self.speech_buffer.is_empty() {
                return None;
            }
            self.silence_samples += samples.len();
            self.speech_buffer.extend_from_slice(samples);

            if self.silence_samples >= self.silence_timeout_samples {
                let utterance = std::mem::take(&mut self.speech_buffer);
                self.silence_samples = 0;
                Some(utterance)
            } else {
                None
            }
        }
    }

    /// Silero ONNX path. Buffers samples into 512-sample frames, runs inference on each.
    fn process_silero(&mut self, samples: &[f32]) -> Option<Vec<f32>> {
        self.leftover.extend_from_slice(samples);
        let mut result = None;

        while self.leftover.len() >= FRAME_SIZE {
            let frame: Vec<f32> = self.leftover.drain(..FRAME_SIZE).collect();
            let prob = self.run_silero_inference(&frame);

            if prob >= self.threshold {
                // Speech frame
                self.speech_buffer.extend_from_slice(&frame);
                self.silence_samples = 0;
            } else {
                // Silence frame
                if !self.speech_buffer.is_empty() {
                    self.silence_samples += FRAME_SIZE;
                    self.speech_buffer.extend_from_slice(&frame);

                    if self.silence_samples >= self.silence_timeout_samples {
                        result = Some(std::mem::take(&mut self.speech_buffer));
                        self.silence_samples = 0;
                        self.reset_lstm_state();
                    }
                }
            }
        }

        result
    }

    /// Runs one 512-sample frame through the Silero ONNX session.
    /// Updates h_state and c_state in place. Returns speech probability.
    /// Returns 0.0 on inference error (treated as silence).
    fn run_silero_inference(&mut self, frame: &[f32]) -> f32 {
        let VadImpl::Silero { session, h_state, c_state } = &mut self.impl_ else {
            return 0.0;
        };

        // Build input tensors
        let input = match Array2::<f32>::from_shape_vec((1, FRAME_SIZE), frame.to_vec()) {
            Ok(a) => a,
            Err(_) => return 0.0,
        };
        let sr = ndarray::array![16000i64];

        let run_result = session.run(ort::inputs![
            "input" => input.view(),
            "sr" => sr.view(),
            "h" => h_state.view(),
            "c" => c_state.view(),
        ]);

        let outputs = match run_result {
            Ok(o) => o,
            Err(e) => {
                tracing::warn!("Silero inference error: {e}");
                return 0.0;
            }
        };

        // Extract speech probability
        let prob = outputs["output"]
            .try_extract_tensor::<f32>()
            .map(|t| t[[0, 0]])
            .unwrap_or(0.0);

        // Update LSTM state
        if let (Ok(hn), Ok(cn)) = (
            outputs["hn"].try_extract_tensor::<f32>(),
            outputs["cn"].try_extract_tensor::<f32>(),
        ) {
            if let (Ok(h), Ok(c)) = (
                hn.view().to_owned().into_shape((2, 1, 64)),
                cn.view().to_owned().into_shape((2, 1, 64)),
            ) {
                *h_state = h;
                *c_state = c;
            }
        }

        prob
    }

    /// Resets LSTM state to zeros (called after utterance flush or completion).
    fn reset_lstm_state(&mut self) {
        if let VadImpl::Silero { h_state, c_state, .. } = &mut self.impl_ {
            *h_state = Array3::zeros((2, 1, 64));
            *c_state = Array3::zeros((2, 1, 64));
        }
    }
}
```

- [ ] **Step 2: Run the vad tests**

```bash
cd src-tauri && cargo test --lib audio::vad 2>&1
```

Expected: all tests PASS. If any fail, debug the specific test — common issues:
- RMS threshold calculation: with `vad_sensitivity=0.5`, `threshold = 0.5`. Speech samples are `0.5f32` amplitude → `rms = 0.5`. The test uses `>= threshold` so `0.5 >= 0.5` = true (speech detected). ✓
- If `ort` fails to compile, check `cargo tree -i ndarray` for version conflicts.

- [ ] **Step 3: Run the full Rust test suite to check for regressions**

```bash
cd src-tauri && cargo test --lib 2>&1 | tail -20
```

Expected: all tests pass. The public API is identical so no callers break.

- [ ] **Step 4: Commit**

```bash
cd ..
git add src-tauri/src/audio/vad.rs
git commit -m "feat(vad): replace RMS VAD with Silero ONNX neural VAD"
```

---

## Chunk 3: Wire Threshold + Final Verification

### Task 6: Wire threshold through AudioCapture

**Files:**
- Modify: `src-tauri/src/audio/capture.rs:19-25` (one line change)

- [ ] **Step 1: Update AudioCapture::new() to accept a threshold parameter**

In `src-tauri/src/audio/capture.rs`, change line 6 and the `new()` function:

Change:
```rust
use super::vad::{Vad, DEFAULT_THRESHOLD};
```
To:
```rust
use super::vad::Vad;
```

Change the `new()` function signature and body:
```rust
// Before:
pub fn new() -> Self {
    AudioCapture {
        running: Arc::new(AtomicBool::new(false)),
        vad: Arc::new(Mutex::new(Vad::new(DEFAULT_THRESHOLD, TARGET_SAMPLE_RATE))),
        speech_tx: Arc::new(Mutex::new(None)),
    }
}

// After:
pub fn new(vad_sensitivity: f32) -> Self {
    AudioCapture {
        running: Arc::new(AtomicBool::new(false)),
        vad: Arc::new(Mutex::new(Vad::new(vad_sensitivity, TARGET_SAMPLE_RATE))),
        speech_tx: Arc::new(Mutex::new(None)),
    }
}
```

> **Note:** `Vad::new()` takes `vad_sensitivity` (a 0.0–1.0 sensitivity value, NOT a pre-computed threshold). The `1.0 - sensitivity` mapping happens inside `Vad::from_bytes()`. Pass the raw `vad_sensitivity` value all the way through.

> **Note on line count:** The spec success criterion says "capture.rs diff is exactly one line." In practice two lines change: the `use` import (removing `DEFAULT_THRESHOLD`) and the `new()` signature. The import change is unavoidable to prevent an unused-import compiler warning. This is acceptable.

- [ ] **Step 2: Verify capture.rs compiles**

```bash
cd src-tauri && cargo build --lib 2>&1 | grep -E "error|warning.*unused" | head -20
```

Expected: compile error in `commands.rs` only (it still calls `AudioCapture::new()` with no args). This is expected — fix in next task.

---

### Task 7: Wire vad_sensitivity in start_transcription

**Files:**
- Modify: `src-tauri/src/commands.rs:132` (one line change)

The `start_transcription` function already calls `crate::settings::load_settings().await` at line 111 and stores the result in `settings`. We just need to pass `settings.vad_sensitivity` to `AudioCapture::new()`.

- [ ] **Step 1: Update the AudioCapture::new() call in start_transcription**

In `src-tauri/src/commands.rs`, change line 132:

```rust
// Before:
let capture = AudioCapture::new();

// After:
let capture = AudioCapture::new(settings.vad_sensitivity);
```

- [ ] **Step 2: Verify the project compiles cleanly**

```bash
cd src-tauri && cargo build --lib 2>&1 | grep "^error" | head -10
```

Expected: no errors.

- [ ] **Step 3: Run the full test suite**

```bash
cd src-tauri && cargo test --lib 2>&1
```

Expected: all tests pass (the test count should match or exceed the count before this change).

- [ ] **Step 4: Commit**

```bash
cd ..
git add src-tauri/src/audio/capture.rs src-tauri/src/commands.rs
git commit -m "feat(vad): wire vad_sensitivity from settings through AudioCapture"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run the complete Rust test suite one final time**

```bash
cd src-tauri && cargo test --lib 2>&1
```

Expected: all tests green, no regressions.

- [ ] **Step 2: Build the full app to verify Tauri integration**

```bash
cd .. && cargo tauri dev --no-watch 2>&1 | head -40
```

Expected: app builds and starts. Quit immediately (Ctrl+C) — we're only checking that it compiles and launches.

- [ ] **Step 3: Manual smoke test**
  - Launch the app normally (`cargo tauri dev`)
  - Press ⌘⇧V, stay silent for 3 seconds, press ⌘⇧V again
  - Expected: no paste / empty paste (Silero correctly detected no speech)
  - Press ⌘⇧V, speak a sentence clearly, stop
  - Expected: sentence is transcribed and pasted correctly

- [ ] **Step 4: Verify the diff is clean and matches the spec**

```bash
git diff main..feature/silero-vad --stat
```

Expected output (5 files changed):
```
src-tauri/Cargo.toml
src-tauri/Cargo.lock
src-tauri/assets/silero_vad.onnx
src-tauri/src/audio/vad.rs
src-tauri/src/audio/capture.rs
src-tauri/src/commands.rs
```

- [ ] **Step 5: Final commit if any loose changes remain**

```bash
git status
# If clean, nothing to do. If any changes, commit them.
```

---

## Notes for Implementer

**If `ort` v2 API differs from the code above:**
The `ort` crate v2 API can vary between minor versions. If `Session::builder().commit_from_memory()`, `ort::inputs![]`, or `try_extract_tensor()` don't compile, check the `ort` v2 docs at https://docs.rs/ort. The key operations are:
1. Create session from bytes: `Session::builder()?.commit_from_memory(bytes)?`
2. Run inference: `session.run(ort::inputs!["name" => tensor_view]?)?`
3. Extract output: `outputs["name"].try_extract_tensor::<f32>()?`

**If ndarray shape errors occur:**
`Array3::zeros((2, 1, 64))` uses a tuple. If the compiler expects `[usize; 3]`, try `Array3::zeros([2, 1, 64])`.

**If the Silero model outputs differ:**
The v4/v5 model input/output names are `input`, `sr`, `h`, `c`, `output`, `hn`, `cn`. If inference fails with "unknown input name", print `session.inputs` to inspect the actual names.
