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
