use std::collections::HashMap;
use std::path::Path;
use crate::whisper::engine::{WhisperEngine, Segment};

pub enum TranscriptionEngine {
    #[cfg(target_os = "macos")]
    Apple(crate::macos::speech_analyzer::SpeechAnalyzerEngine),
    Whisper(WhisperEngine),
    #[cfg(target_os = "macos")]
    Moonshine(crate::moonshine::engine::MoonshineEngine),
}

impl TranscriptionEngine {
    /// Returns the best available engine for this platform.
    /// `engine_preference` is "auto" | "apple" | "whisper" | "moonshine".
    /// Falls back to Whisper if the preferred engine is unavailable.
    pub fn select(model_path: &Path, engine_preference: &str, settings: &crate::settings::Settings) -> anyhow::Result<Self> {
        #[cfg(target_os = "macos")]
        {
            use crate::macos::speech_analyzer::SpeechAnalyzerEngine;
            match engine_preference {
                "apple" => {
                    if SpeechAnalyzerEngine::is_available() {
                        tracing::info!("Using Apple speech engine (user preference)");
                        return Ok(TranscriptionEngine::Apple(SpeechAnalyzerEngine));
                    }
                    tracing::warn!("Apple Speech requested but not available, falling back to Whisper");
                }
                "auto" => {
                    if SpeechAnalyzerEngine::is_available() {
                        tracing::info!("Using Apple speech engine (auto)");
                        return Ok(TranscriptionEngine::Apple(SpeechAnalyzerEngine));
                    }
                }
                _ => {} // "whisper" / "moonshine" — handled below
            }

            if engine_preference == "moonshine" {
                let variant = &settings.moonshine_model;
                let model_dir = crate::moonshine::models::moonshine_model_dir(variant);
                if !model_dir.exists() {
                    tracing::warn!(
                        "Moonshine model '{}' not downloaded — falling back to Whisper. Download it in Settings → AI Models.",
                        variant
                    );
                } else {
                    let arch = crate::moonshine::models::moonshine_model_arch(variant)
                        .unwrap_or(crate::moonshine::ffi::MOONSHINE_MODEL_ARCH_TINY_STREAMING);
                    match crate::moonshine::engine::MoonshineEngine::new(&model_dir, arch) {
                        Ok(engine) => {
                            tracing::info!("Using Moonshine engine ({})", variant);
                            return Ok(TranscriptionEngine::Moonshine(engine));
                        }
                        Err(e) => {
                            tracing::warn!("Moonshine engine failed to load: {e}, falling back to Whisper");
                        }
                    }
                }
            }
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
            #[cfg(target_os = "macos")]
            TranscriptionEngine::Moonshine(engine) => {
                engine.transcribe(audio, language, translate_to_english, initial_prompt, word_replacements)
            }
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            #[cfg(target_os = "macos")]
            TranscriptionEngine::Apple(_) => "apple",
            TranscriptionEngine::Whisper(_) => "whisper",
            #[cfg(target_os = "macos")]
            TranscriptionEngine::Moonshine(_) => "moonshine",
        }
    }
}

// SAFETY: All contained types are Send.
// - SpeechAnalyzerEngine: explicitly `unsafe impl Send` (zero-sized, no shared state)
// - WhisperEngine: Send (used in std::thread::spawn throughout commands.rs)
unsafe impl Send for TranscriptionEngine {}

#[cfg(test)]
mod tests {
    use super::TranscriptionEngine;

    /// Test that name() returns "apple" for the Apple variant.
    /// We construct SpeechAnalyzerEngine directly since it's zero-sized.
    #[test]
    #[cfg(target_os = "macos")]
    fn apple_engine_name_returns_apple() {
        use crate::macos::speech_analyzer::SpeechAnalyzerEngine;
        let engine = TranscriptionEngine::Apple(SpeechAnalyzerEngine);
        assert_eq!(engine.name(), "apple");
    }
}
