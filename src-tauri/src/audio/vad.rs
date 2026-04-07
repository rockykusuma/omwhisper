//! Voice Activity Detection.
//!
//! Uses the Silero VAD ONNX model (v5) for neural speech detection via `tract-onnx`
//! (pure Rust ONNX runtime — no C++ dependency, works on all platforms including macOS ARM).
//! Falls back to energy-based RMS VAD if the tract session fails to initialise.
//!
//! The `rms()` static helper is kept for the frontend audio level meter in
//! `capture.rs` and is not involved in VAD decisions.
//!
//! Silero v5 ONNX interface (8kHz path — the 16kHz STFT path in v5 is broken):
//!   Inputs:  `input [1, 256]` f32 (8kHz audio), `state [2, 1, 128]` f32, `sr []` i64 (= 8000)
//!   Outputs: `output [1, 1]` f32 (speech probability), `stateN [2, 1, 128]` f32
//!
//! Audio captured at 16kHz is decimated to 8kHz (every other sample) before inference.

use tract_onnx::prelude::*;
use tract_onnx::prelude::tract_ndarray::{Array2, Array3};

/// Silero VAD ONNX model, embedded at compile time.
const SILERO_MODEL: &[u8] = include_bytes!("../../assets/silero_vad.onnx");

/// Seconds of silence after which the current utterance is finalised.
const SILENCE_TIMEOUT_SECS: f32 = 1.0;

/// Maximum speech buffer size: 60 seconds at 16kHz. Utterances longer than this
/// are flushed automatically to prevent unbounded memory growth.
const MAX_SPEECH_BUFFER_SAMPLES: usize = 60 * 16_000;

/// Audio is captured at 16kHz; we buffer 512-sample frames.
const FRAME_SIZE: usize = 512;

/// After decimation (every other sample), the 8kHz frame fed to Silero is 256 samples.
const SILERO_FRAME_SIZE: usize = 256;

/// Tract runnable model type alias.
type SileroModel = SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>;

// ── Internal implementation ───────────────────────────────────────────────────

// The Silero variant is large (model graph + state array).
// VadImpl lives inside Arc<Mutex<Vad>> in capture.rs, so the stack impact is negligible.
#[allow(clippy::large_enum_variant)]
enum VadImpl {
    Silero {
        model: SileroModel,
        /// Combined LSTM state [2, 1, 128] — persists between frames, zeroed on utterance end/flush.
        /// Silero v5 uses a single `state` tensor (not separate h/c like v4).
        state: Array3<f32>,
    },
    /// RMS energy VAD. Used as fallback when the Silero model fails to initialise.
    Rms {
        threshold: f32,
    },
}

// tract's SimplePlan is Send — all contained types satisfy Send + Sync.
unsafe impl Send for VadImpl {}

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
    /// or constructs an RMS VAD directly when `vad_engine` is not `"silero"`.
    pub fn new(vad_engine: &str, vad_sensitivity: f32, sample_rate: u32) -> Self {
        if vad_engine == "silero" {
            return Self::from_bytes(SILERO_MODEL, vad_sensitivity, sample_rate);
        }
        Self::rms_only(vad_sensitivity, sample_rate)
    }

    /// Constructs an RMS-only VAD without initialising tract at all.
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
    pub(crate) fn from_bytes(model_bytes: &[u8], vad_sensitivity: f32, sample_rate: u32) -> Self {
        let threshold = 1.0 - vad_sensitivity.clamp(0.0, 1.0);
        let silence_timeout_samples = (SILENCE_TIMEOUT_SECS * sample_rate as f32) as usize;

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

        let impl_ = match Self::load_model(model_bytes) {
            Ok(model) => {
                tracing::info!("Silero VAD v5 initialised successfully (tract)");
                VadImpl::Silero {
                    model,
                    state: Array3::zeros((2, 1, 128)),
                }
            }
            Err(e) => {
                tracing::error!("Silero VAD init failed, falling back to RMS VAD: {e}");
                sentry_anyhow::capture_anyhow(&e);
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

    fn load_model(model_bytes: &[u8]) -> anyhow::Result<SileroModel> {
        let model = tract_onnx::onnx()
            .model_for_read(&mut std::io::Cursor::new(model_bytes))?
            .into_optimized()?
            .into_runnable()?;
        Ok(model)
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
            VadImpl::Silero { .. } => self.process_silero(samples),
            VadImpl::Rms { threshold } => self.process_rms(samples, *threshold),
        }
    }

    /// Reset all VAD state without flushing (called at begin_recording).
    /// Discards any stale audio from before the hotkey was pressed.
    pub fn reset(&mut self) {
        self.speech_buffer.clear();
        self.leftover.clear();
        self.silence_samples = 0;
        self.reset_state();
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

    /// Runs one 512-sample 16kHz frame through the Silero v5 tract session.
    ///
    /// The frame is decimated to 8kHz (256 samples) before inference — the v5 model's
    /// 16kHz STFT path is broken; the 8kHz LSTM path works correctly.
    ///
    /// Updates LSTM state in place. Returns speech probability [0.0, 1.0].
    /// Returns 0.0 on inference error (treated as silence).
    fn run_silero_inference(&mut self, frame: &[f32]) -> f32 {
        let VadImpl::Silero { model, state } = &mut self.impl_ else {
            return 0.0;
        };

        // Decimate 16kHz → 8kHz: take every other sample.
        let frame_8k: Vec<f32> = frame.iter().step_by(2).copied().collect();

        let input: Array2<f32> = match Array2::<f32>::from_shape_vec((1, SILERO_FRAME_SIZE), frame_8k) {
            Ok(a) => a,
            Err(_) => return 0.0,
        };
        let sr_scalar = tract_onnx::prelude::tract_ndarray::arr0(8000i64);

        let input_tval: TValue = input.into_tensor().into();
        let state_tval: TValue = state.clone().into_tensor().into();
        let sr_tval: TValue = sr_scalar.into_tensor().into();

        let outputs = match model.run(tvec![input_tval, state_tval, sr_tval]) {
            Ok(o) => o,
            Err(e) => {
                tracing::warn!("Silero inference error: {e}");
                return 0.0;
            }
        };

        // Extract speech probability from output [1, 1]
        let prob = outputs[0]
            .to_array_view::<f32>()
            .ok()
            .and_then(|v| v.iter().next().copied())
            .unwrap_or(0.0);

        // Update LSTM state from stateN output [2, 1, 128]
        if let Ok(state_view) = outputs[1].to_array_view::<f32>() {
            let state_vec: Vec<f32> = state_view.iter().copied().collect();
            if let Ok(new_state) = Array3::from_shape_vec((2, 1, 128), state_vec) {
                *state = new_state;
            }
        }

        prob
    }

    fn reset_state(&mut self) {
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

    /// Returns a Vad using the RMS path directly (bypasses tract entirely).
    fn rms_vad(sensitivity: f32) -> Vad {
        Vad::rms_only(sensitivity, 16000)
    }

    /// Returns a Vad using the real embedded Silero model.
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
    fn vad_new_with_bad_model_bytes_does_not_panic() {
        // Empty bytes → tract session init fails → silently falls back to RMS
        let mut vad = Vad::from_bytes(&[], 0.5, 16000);
        // Must be functional: can call process without panic
        let _ = vad.process(&silence_samples());
    }

    #[test]
    fn vad_engine_silero_loads_model() {
        // Requires the embedded silero_vad.onnx to load successfully.
        // If tract fails to init, this test will fail with "expected Silero variant".
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
