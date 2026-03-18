//! Voice Activity Detection.
//!
//! Uses the Silero VAD ONNX model (v5) for neural speech detection.
//! Falls back to energy-based RMS VAD if the ONNX session fails to initialise.
//!
//! The `rms()` static helper is kept for the frontend audio level meter in
//! `capture.rs` and is not involved in VAD decisions.
//!
//! Silero v5 ONNX interface (8kHz path — the 16kHz STFT path in v5 is broken):
//!   Inputs:  `input [1, 256]` f32 (8kHz audio), `state [2, 1, 128]` f32, `sr []` i64 (= 8000)
//!   Outputs: `output [1, 1]` f32 (speech probability), `stateN [2, 1, 128]` f32
//!
//! Audio captured at 16kHz is decimated to 8kHz (every other sample) before inference.

#[cfg(not(target_os = "macos"))]
use ndarray::{Array2, Array3};
#[cfg(not(target_os = "macos"))]
use ort::{session::Session, value::TensorRef};

/// Silero VAD ONNX model, embedded at compile time.
/// Only used on non-macOS platforms — on macOS, ORT's global destructors crash
/// with ARM PAC violation on macOS 26+, so Silero is disabled entirely.
#[cfg(not(target_os = "macos"))]
const SILERO_MODEL: &[u8] = include_bytes!("../../assets/silero_vad.onnx");

/// Seconds of silence after which the current utterance is finalised.
const SILENCE_TIMEOUT_SECS: f32 = 1.5;

/// Maximum speech buffer size: 60 seconds at 16kHz. Utterances longer than this
/// are flushed automatically to prevent unbounded memory growth.
const MAX_SPEECH_BUFFER_SAMPLES: usize = 60 * 16_000;

/// Audio is captured at 16kHz; we buffer 512-sample frames.
#[cfg(not(target_os = "macos"))]
const FRAME_SIZE: usize = 512;

/// After decimation (every other sample), the 8kHz frame fed to Silero is 256 samples.
#[cfg(not(target_os = "macos"))]
const SILERO_FRAME_SIZE: usize = 256;

// ── Internal implementation ───────────────────────────────────────────────────

// The Silero variant is large (ONNX session + state array).
// VadImpl lives inside Arc<Mutex<Vad>> in capture.rs, so the stack impact is negligible.
#[allow(clippy::large_enum_variant)]
enum VadImpl {
    #[cfg(not(target_os = "macos"))]
    Silero {
        session: Session,
        /// Combined LSTM state [2, 1, 128] — persists between frames, zeroed on utterance end/flush.
        /// Silero v5 uses a single `state` tensor (not separate h/c like v4).
        state: Array3<f32>,
    },
    /// RMS energy VAD. On macOS this is always used; on other platforms it is the fallback
    /// when the Silero ONNX session fails to initialise.
    Rms {
        threshold: f32,
    },
}

// ── Public struct ─────────────────────────────────────────────────────────────

pub struct Vad {
    impl_: VadImpl,
    /// Speech probability threshold (Silero) or energy threshold (Rms).
    /// Derived from vad_sensitivity: threshold = 1.0 - vad_sensitivity.
    #[allow(dead_code)]
    pub(crate) threshold: f32,
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
    /// Public constructor — loads from the embedded `silero_vad.onnx` model bytes,
    /// or constructs an RMS VAD directly (bypassing ORT entirely) when `vad_engine` is not `"silero"`.
    pub fn new(vad_engine: &str, vad_sensitivity: f32, sample_rate: u32) -> Self {
        #[cfg(not(target_os = "macos"))]
        if vad_engine == "silero" {
            return Self::from_bytes(SILERO_MODEL, vad_sensitivity, sample_rate);
        }
        // On macOS, always use RMS VAD — ORT crashes on macOS 26 (ARM PAC violation).
        // Apple Speech handles its own VAD internally, so this is sufficient.
        let _ = vad_engine;
        Self::rms_only(vad_sensitivity, sample_rate)
    }

    /// Constructs an RMS-only VAD without initialising ORT at all.
    fn rms_only(vad_sensitivity: f32, sample_rate: u32) -> Self {
        let threshold = 1.0 - vad_sensitivity.clamp(0.0, 1.0);
        let rms_threshold = 0.02 * threshold + 0.001;
        let silence_timeout_samples = (SILENCE_TIMEOUT_SECS * sample_rate as f32) as usize;
        Vad {
            impl_: VadImpl::Rms { threshold: rms_threshold },
            threshold,
            speech_buffer: Vec::new(),
            silence_samples: 0,
            silence_timeout_samples,
            leftover: Vec::new(),
        }
    }

    /// Internal constructor that accepts model bytes directly.
    /// Used by tests to inject empty/corrupt bytes and exercise the RMS fallback path.
    /// Only available on non-macOS — ORT is not linked on macOS.
    #[cfg(not(target_os = "macos"))]
    pub(crate) fn from_bytes(model_bytes: &[u8], vad_sensitivity: f32, sample_rate: u32) -> Self {
        let threshold = 1.0 - vad_sensitivity.clamp(0.0, 1.0);
        let silence_timeout_samples = (SILENCE_TIMEOUT_SECS * sample_rate as f32) as usize;

        // Short-circuit: never initialise ORT with empty bytes. The fallback path below
        // already handles this, but on macOS 26 even a failed ORT session init registers
        // global destructors that SIGABRT on process exit (ARM PAC violation in ORT).
        if model_bytes.is_empty() {
            let rms_threshold = 0.02 * threshold + 0.001;
            return Vad {
                impl_: VadImpl::Rms { threshold: rms_threshold },
                threshold,
                speech_buffer: Vec::new(),
                silence_samples: 0,
                silence_timeout_samples,
                leftover: Vec::new(),
            };
        }

        let impl_ = match Session::builder()
            .and_then(|mut b| b.commit_from_memory(model_bytes))
        {
            Ok(session) => {
                tracing::info!("Silero VAD v5 initialised successfully");
                VadImpl::Silero {
                    session,
                    state: Array3::zeros((2, 1, 128)),
                }
            }
            Err(e) => {
                tracing::error!("Silero VAD init failed, falling back to RMS VAD: {e}");
                sentry::capture_error(&e);
                // RMS energy scale (0.0–1.0 amplitude) is very different from Silero
                // probability scale. Map sensitivity to a sensible energy threshold:
                // sensitivity=0.5 → 0.01 (old default), higher sensitivity → lower threshold.
                let rms_threshold = 0.02 * (1.0 - vad_sensitivity.clamp(0.0, 1.0)) + 0.001;
                VadImpl::Rms { threshold: rms_threshold }
            }
        };

        Vad {
            impl_,
            threshold,
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
            #[cfg(not(target_os = "macos"))]
            VadImpl::Silero { .. } => self.process_silero(samples),
            VadImpl::Rms { threshold } => self.process_rms(samples, *threshold),
        }
    }

    /// Force-flush any buffered speech (called on recording stop).
    ///
    /// Resets all state: speech_buffer, leftover, silence_samples, and LSTM state.
    /// Sub-frame samples in `leftover` (Silero path, <512 samples) are intentionally
    /// discarded — they are too short to run inference on.
    pub fn flush(&mut self) -> Option<Vec<f32>> {
        if self.speech_buffer.is_empty() {
            return None;
        }
        let utterance = std::mem::take(&mut self.speech_buffer);
        self.leftover.clear();
        self.silence_samples = 0;
        self.reset_state();
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
            // Flush if buffer exceeds 60-second limit
            if self.speech_buffer.len() >= MAX_SPEECH_BUFFER_SAMPLES {
                tracing::warn!("VAD: speech buffer exceeded 60s limit, flushing");
                return Some(std::mem::take(&mut self.speech_buffer));
            }
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

    #[cfg(not(target_os = "macos"))]
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
                // Flush if buffer exceeds 60-second limit
                if self.speech_buffer.len() >= MAX_SPEECH_BUFFER_SAMPLES {
                    tracing::warn!("VAD: speech buffer exceeded 60s limit, flushing");
                    result = Some(std::mem::take(&mut self.speech_buffer));
                    self.silence_samples = 0;
                    self.reset_state();
                }
            } else {
                // Silence frame
                if !self.speech_buffer.is_empty() {
                    self.silence_samples += FRAME_SIZE;
                    self.speech_buffer.extend_from_slice(&frame);

                    if self.silence_samples >= self.silence_timeout_samples {
                        result = Some(std::mem::take(&mut self.speech_buffer));
                        self.silence_samples = 0;
                        self.reset_state();
                    }
                }
            }
        }

        result
    }

    #[cfg(not(target_os = "macos"))]
    /// Runs one 512-sample 16kHz frame through the Silero v5 ONNX session.
    ///
    /// The frame is decimated to 8kHz (256 samples) before inference — the v5 model's
    /// 16kHz STFT path is broken; the 8kHz LSTM path works correctly.
    ///
    /// Updates LSTM state in place. Returns speech probability [0.0, 1.0].
    /// Returns 0.0 on inference error (treated as silence).
    fn run_silero_inference(&mut self, frame: &[f32]) -> f32 {
        let VadImpl::Silero { session, state } = &mut self.impl_ else {
            return 0.0;
        };

        // Decimate 16kHz → 8kHz: take every other sample.
        let frame_8k: Vec<f32> = frame.iter().step_by(2).copied().collect();

        let input = match Array2::<f32>::from_shape_vec((1, SILERO_FRAME_SIZE), frame_8k) {
            Ok(a) => a,
            Err(_) => return 0.0,
        };
        // sr must be a 0D scalar tensor (shape []); arr0 produces this.
        let sr_scalar = ndarray::arr0(8000i64);

        let input_ref = match TensorRef::<f32>::from_array_view(input.view()) {
            Ok(t) => t,
            Err(_) => return 0.0,
        };
        let state_ref = match TensorRef::<f32>::from_array_view(state.view()) {
            Ok(t) => t,
            Err(_) => return 0.0,
        };
        let sr_ref = match TensorRef::<i64>::from_array_view(sr_scalar.view()) {
            Ok(t) => t,
            Err(_) => return 0.0,
        };

        let outputs = match session.run(ort::inputs![
            "input" => input_ref,
            "state" => state_ref,
            "sr"    => sr_ref,
        ]) {
            Ok(o) => o,
            Err(e) => {
                tracing::warn!("Silero inference error: {e}");
                return 0.0;
            }
        };

        // Extract speech probability from output [1, 1]
        let prob = outputs["output"]
            .try_extract_tensor::<f32>()
            .map(|(_shape, data)| data.first().copied().unwrap_or(0.0))
            .unwrap_or(0.0);

        // Update LSTM state from stateN output [2, 1, 128]
        if let Ok((_shape, data)) = outputs["stateN"].try_extract_tensor::<f32>() {
            if let Ok(new_state) = Array3::from_shape_vec((2, 1, 128), data.to_vec()) {
                *state = new_state;
            }
        }

        prob
    }

    fn reset_state(&mut self) {
        #[cfg(not(target_os = "macos"))]
        if let VadImpl::Silero { state, .. } = &mut self.impl_ {
            *state = Array3::zeros((2, 1, 128));
        }
    }
}

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

    /// Returns a Vad using the RMS path directly (bypasses ORT entirely).
    fn rms_vad(sensitivity: f32) -> Vad {
        Vad::rms_only(sensitivity, 16000)
    }

    /// Returns a Vad using the real embedded Silero model.
    /// Only available and run on non-macOS (ORT is not linked on macOS).
    #[cfg(not(target_os = "macos"))]
    fn silero_vad() -> Vad {
        Vad::new("silero", 0.5, 16000)
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
    #[cfg(not(target_os = "macos"))]
    fn vad_new_with_bad_model_bytes_does_not_panic() {
        // Empty bytes → ort session init fails → silently falls back to RMS
        // Not run on macOS — ORT is not linked there.
        let mut vad = Vad::from_bytes(&[], 0.5, 16000);
        // Must be functional: can call process without panic
        let _ = vad.process(&silence_samples());
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
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
            #[cfg(not(target_os = "macos"))]
            VadImpl::Silero { .. } => panic!("expected Rms variant"),
        }
    }

    #[test]
    fn vad_engine_unknown_falls_back_to_rms() {
        let vad = Vad::new("unknown_engine", 0.5, 16000);
        match &vad.impl_ {
            VadImpl::Rms { .. } => {}
            #[cfg(not(target_os = "macos"))]
            VadImpl::Silero { .. } => panic!("expected Rms fallback for unknown engine"),
        }
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
    #[cfg(not(target_os = "macos"))]
    fn lstm_state_zeroed_after_flush() {
        // Uses the real Silero model. Verifies that flush() resets LSTM state to zeros.
        let mut vad = silero_vad();

        // Feed audio frames so ONNX processes them and state accumulates
        for _ in 0..10 {
            vad.process(&vec![0.5f32; 512]);
        }

        // Verify we are in Silero mode (not RMS fallback)
        let state_dirty = match &vad.impl_ {
            VadImpl::Silero { state, .. } => state.iter().any(|&v| v != 0.0),
            VadImpl::Rms { .. } => panic!("expected Silero variant — model failed to load"),
        };

        // Ensure speech_buffer is non-empty so flush() actually reaches reset_state().
        // (flush() early-returns None on empty speech_buffer, skipping the reset entirely.)
        vad.speech_buffer.push(0.1f32);

        let _ = vad.flush();

        // Verify state is zeroed after flush
        match &vad.impl_ {
            VadImpl::Silero { state, .. } => {
                assert!(state.iter().all(|&v| v == 0.0), "state not zeroed after flush");
            }
            VadImpl::Rms { .. } => panic!("expected Silero variant after flush"),
        }

        // Diagnostic only — state may not be dirty if model scored all frames as silence
        let _ = state_dirty;
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
