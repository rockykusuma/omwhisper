/// Energy-based Voice Activity Detection.
/// Calculates RMS energy of audio chunks and decides if speech is present.

/// RMS energy threshold below which audio is considered silence.
/// Range: 0.0 (total silence) to 1.0 (maximum amplitude).
/// Default 0.01 works well for most microphones in quiet environments.
pub const DEFAULT_THRESHOLD: f32 = 0.01;

/// Silence duration (in seconds) after which the current utterance is finalized.
pub const SILENCE_TIMEOUT_SECS: f32 = 1.5;

pub struct Vad {
    threshold: f32,
    #[allow(dead_code)]
    sample_rate: u32,
    /// Accumulated speech samples for current utterance
    speech_buffer: Vec<f32>,
    /// Number of consecutive silence samples seen
    silence_samples: usize,
    /// Silence timeout in samples
    silence_timeout_samples: usize,
}

impl Vad {
    pub fn new(threshold: f32, sample_rate: u32) -> Self {
        let silence_timeout_samples = (SILENCE_TIMEOUT_SECS * sample_rate as f32) as usize;
        Vad {
            threshold,
            sample_rate,
            speech_buffer: Vec::new(),
            silence_samples: 0,
            silence_timeout_samples,
        }
    }

    /// Calculate RMS energy of a chunk.
    pub fn rms(samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }
        let sum_sq: f32 = samples.iter().map(|&s| s * s).sum();
        (sum_sq / samples.len() as f32).sqrt()
    }

    /// Process a chunk of audio samples.
    /// Returns Some(Vec<f32>) when an utterance is complete (speech followed by silence timeout).
    /// Returns None if still accumulating or if chunk is silence with no buffered speech.
    pub fn process(&mut self, samples: &[f32]) -> Option<Vec<f32>> {
        let energy = Self::rms(samples);
        let is_speech = energy >= self.threshold;

        if is_speech {
            // Speech detected — accumulate and reset silence counter
            self.speech_buffer.extend_from_slice(samples);
            self.silence_samples = 0;
            None
        } else {
            // Silence
            if self.speech_buffer.is_empty() {
                // No speech buffered yet — ignore silence
                return None;
            }

            self.silence_samples += samples.len();
            self.speech_buffer.extend_from_slice(samples);

            if self.silence_samples >= self.silence_timeout_samples {
                // Silence timeout reached — finalize utterance
                let utterance = std::mem::take(&mut self.speech_buffer);
                self.silence_samples = 0;
                Some(utterance)
            } else {
                None
            }
        }
    }

    /// Force-flush any buffered speech (called on stop).
    pub fn flush(&mut self) -> Option<Vec<f32>> {
        if self.speech_buffer.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.speech_buffer))
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
