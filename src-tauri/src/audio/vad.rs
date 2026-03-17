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

    // ── rms ──────────────────────────────────────────────────────────────────

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
        // Signal alternating +1 / -1 has RMS = 1.0
        let signal: Vec<f32> = (0..100).map(|i| if i % 2 == 0 { 1.0 } else { -1.0 }).collect();
        let rms = Vad::rms(&signal);
        assert!((rms - 1.0).abs() < 1e-5, "expected ~1.0, got {rms}");
    }

    #[test]
    fn rms_of_dc_offset_equals_amplitude() {
        let signal = vec![0.5f32; 64];
        let rms = Vad::rms(&signal);
        assert!((rms - 0.5).abs() < 1e-5, "expected ~0.5, got {rms}");
    }

    #[test]
    fn rms_single_sample() {
        let rms = Vad::rms(&[0.8]);
        assert!((rms - 0.8).abs() < 1e-5);
    }

    // ── process ──────────────────────────────────────────────────────────────

    #[test]
    fn silence_with_no_buffer_returns_none() {
        let mut vad = Vad::new(0.01, 16000);
        let silence = vec![0.0f32; 1600];
        assert!(vad.process(&silence).is_none());
    }

    #[test]
    fn speech_chunk_accumulates_and_returns_none() {
        let mut vad = Vad::new(0.01, 16000);
        let speech = vec![0.5f32; 1600]; // well above threshold
        assert!(vad.process(&speech).is_none()); // still accumulating
    }

    #[test]
    fn utterance_flushed_after_silence_timeout() {
        // silence_timeout = 1.5s * 16000 = 24000 samples
        let mut vad = Vad::new(0.01, 16000);
        let speech = vec![0.5f32; 1600];
        let silence = vec![0.0f32; 1600];

        // Feed speech
        assert!(vad.process(&speech).is_none());

        // Feed silence until timeout (24000 / 1600 = 15 chunks)
        let mut result = None;
        for _ in 0..15 {
            result = vad.process(&silence);
            if result.is_some() { break; }
        }
        assert!(result.is_some(), "expected utterance after silence timeout");
        let utterance = result.unwrap();
        // Utterance should include the speech samples
        assert!(utterance.len() >= 1600);
    }

    #[test]
    fn speech_followed_by_speech_keeps_accumulating() {
        let mut vad = Vad::new(0.01, 16000);
        let speech = vec![0.5f32; 1600];
        assert!(vad.process(&speech).is_none());
        assert!(vad.process(&speech).is_none()); // still no silence timeout
    }

    #[test]
    fn silence_resets_after_utterance_flushed() {
        let mut vad = Vad::new(0.01, 16000);
        let speech = vec![0.5f32; 1600];
        let silence = vec![0.0f32; 1600];

        vad.process(&speech);
        // Drain silence to trigger flush
        for _ in 0..15 { vad.process(&silence); }

        // After flush, more silence should return None
        assert!(vad.process(&silence).is_none());
    }

    // ── flush ─────────────────────────────────────────────────────────────────

    #[test]
    fn flush_empty_buffer_returns_none() {
        let mut vad = Vad::new(0.01, 16000);
        assert!(vad.flush().is_none());
    }

    #[test]
    fn flush_returns_buffered_speech() {
        let mut vad = Vad::new(0.01, 16000);
        let speech = vec![0.5f32; 800];
        vad.process(&speech);
        let flushed = vad.flush();
        assert!(flushed.is_some());
        assert_eq!(flushed.unwrap().len(), 800);
    }

    #[test]
    fn flush_clears_buffer() {
        let mut vad = Vad::new(0.01, 16000);
        let speech = vec![0.5f32; 800];
        vad.process(&speech);
        vad.flush();
        // Second flush should be empty
        assert!(vad.flush().is_none());
    }
}
