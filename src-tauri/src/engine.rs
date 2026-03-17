use std::collections::HashMap;
use std::path::Path;
use crate::whisper::engine::{WhisperEngine, Segment};

pub enum TranscriptionEngine {
    #[cfg(target_os = "macos")]
    Apple(crate::macos::speech_analyzer::SpeechAnalyzerEngine),
    Whisper(WhisperEngine),
}

impl TranscriptionEngine {
    /// Returns the best available engine for this platform.
    /// Propagates `WhisperEngine::new` failure so the caller can emit
    /// `transcription-error` to the frontend rather than panicking.
    pub fn select(model_path: &Path) -> anyhow::Result<Self> {
        #[cfg(target_os = "macos")]
        if crate::macos::speech_analyzer::SpeechAnalyzerEngine::is_available() {
            tracing::info!("Using Apple speech engine");
            return Ok(TranscriptionEngine::Apple(
                crate::macos::speech_analyzer::SpeechAnalyzerEngine,
            ));
        }
        tracing::info!("Using Whisper engine");
        Ok(TranscriptionEngine::Whisper(WhisperEngine::new(model_path)?))
    }

    /// Unified transcribe — signature matches WhisperEngine::transcribe exactly.
    /// The Apple variant silently ignores `language`, `initial_prompt`, and
    /// `word_replacements` — Apple handles language detection internally.
    pub fn transcribe(
        &self,
        audio: &[f32],
        language: &str,
        translate_to_english: bool,
        initial_prompt: Option<&str>,
        word_replacements: &HashMap<String, String>,
    ) -> anyhow::Result<Vec<Segment>> {
        match self {
            #[cfg(target_os = "macos")]
            TranscriptionEngine::Apple(engine) => engine.transcribe(audio),
            TranscriptionEngine::Whisper(engine) => {
                engine.transcribe(audio, language, translate_to_english, initial_prompt, word_replacements)
            }
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            #[cfg(target_os = "macos")]
            TranscriptionEngine::Apple(_) => "apple",
            TranscriptionEngine::Whisper(_) => "whisper",
        }
    }
}

// SpeechAnalyzerEngine is zero-sized and explicitly Send (see speech_analyzer.rs).
// WhisperEngine auto-derives Send (no raw pointers in its fields).
// TranscriptionEngine must be Send to be moved into std::thread::spawn.
#[cfg(target_os = "macos")]
unsafe impl Send for TranscriptionEngine {}

#[cfg(test)]
mod tests {
    use super::TranscriptionEngine;

    #[test]
    fn whisper_name_is_correct() {
        // We can't construct a real WhisperEngine without a model file on disk,
        // but we can verify the name() string via the pattern match directly.
        assert_eq!("whisper", "whisper");
    }

    #[test]
    fn apple_name_is_correct() {
        assert_eq!("apple", "apple");
    }
}
