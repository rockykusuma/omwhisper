use std::collections::HashMap;
use std::path::Path;
use crate::whisper::engine::{WhisperEngine, Segment};

/// The 25 European languages covered by Parakeet TDT 0.6B v3 (ISO 639-1).
pub const EUROPEAN_25: &[&str] = &[
    "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it",
    "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk",
];

/// Pure language → engine routing. Used by `select()` and unit-tested in isolation.
/// Order matters: translate → fast-english → Parakeet (auto/European) → Whisper.
pub fn pick_engine(language: &str, translate_to_english: bool, fast_english_mode: bool) -> &'static str {
    if translate_to_english && language != "en" {
        return "whisper"; // only Whisper translates
    }
    if fast_english_mode && language == "en" {
        return "moonshine";
    }
    if language == "auto" || EUROPEAN_25.contains(&language) {
        return "parakeet";
    }
    "whisper"
}

pub enum TranscriptionEngine {
    Whisper(WhisperEngine),
    #[cfg(target_os = "macos")]
    Moonshine(crate::moonshine::engine::MoonshineEngine),
    #[cfg(target_os = "macos")]
    Parakeet(crate::parakeet::engine::ParakeetEngine),
}

impl TranscriptionEngine {
    /// Returns the best available engine for this platform.
    /// `engine_preference` is "parakeet" | "whisper" | "moonshine".
    /// Falls back to Whisper if the preferred engine is unavailable.
    pub fn select(model_path: &Path, engine_preference: &str, settings: &crate::settings::Settings) -> anyhow::Result<Self> {
        #[cfg(target_os = "macos")]
        if engine_preference == "parakeet" {
            let variant = crate::parakeet::models::PARAKEET_V3_VARIANT;
            if !crate::parakeet::models::is_parakeet_downloaded(variant) {
                tracing::warn!(
                    "Parakeet model not downloaded — falling back to Whisper. Download it in Settings → AI Models."
                );
            } else {
                let model_dir = crate::parakeet::models::parakeet_model_dir(variant);
                match crate::parakeet::engine::ParakeetEngine::new(&model_dir) {
                    Ok(engine) => {
                        tracing::info!("Using Parakeet engine");
                        return Ok(TranscriptionEngine::Parakeet(engine));
                    }
                    Err(e) => {
                        tracing::warn!("Parakeet engine failed to load: {e}, falling back to Whisper");
                    }
                }
            }
        }

        #[cfg(target_os = "macos")]
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

        tracing::info!("Using Whisper engine");
        Ok(TranscriptionEngine::Whisper(WhisperEngine::new(model_path)?))
    }

    pub fn transcribe(
        &self,
        audio: &[f32],
        language: &str,
        translate_to_english: bool,
        initial_prompt: Option<&str>,
        word_replacements: &HashMap<String, String>,
    ) -> anyhow::Result<Vec<Segment>> {
        match self {
            TranscriptionEngine::Whisper(engine) => {
                engine.transcribe(audio, language, translate_to_english, initial_prompt, word_replacements)
            }
            #[cfg(target_os = "macos")]
            TranscriptionEngine::Moonshine(engine) => {
                engine.transcribe(audio, language, translate_to_english, initial_prompt, word_replacements)
            }
            #[cfg(target_os = "macos")]
            TranscriptionEngine::Parakeet(engine) => {
                engine.transcribe(audio, language, translate_to_english, initial_prompt, word_replacements)
            }
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            TranscriptionEngine::Whisper(_) => "whisper",
            #[cfg(target_os = "macos")]
            TranscriptionEngine::Moonshine(_) => "moonshine",
            #[cfg(target_os = "macos")]
            TranscriptionEngine::Parakeet(_) => "parakeet",
        }
    }
}

// SAFETY: WhisperEngine, MoonshineEngine and ParakeetEngine are Send.
unsafe impl Send for TranscriptionEngine {}

#[cfg(test)]
mod selection_tests {
    use super::pick_engine;

    #[test]
    fn translate_non_english_forces_whisper() {
        assert_eq!(pick_engine("fr", true, false), "whisper");
    }

    #[test]
    fn fast_english_mode_uses_moonshine() {
        assert_eq!(pick_engine("en", false, true), "moonshine");
    }

    #[test]
    fn auto_uses_parakeet() {
        assert_eq!(pick_engine("auto", false, false), "parakeet");
    }

    #[test]
    fn european_language_uses_parakeet() {
        assert_eq!(pick_engine("es", false, false), "parakeet");
        assert_eq!(pick_engine("uk", false, false), "parakeet");
    }

    #[test]
    fn non_european_language_uses_whisper() {
        assert_eq!(pick_engine("zh", false, false), "whisper");
        assert_eq!(pick_engine("ja", false, false), "whisper");
    }

    #[test]
    fn fast_english_mode_ignored_for_non_english() {
        assert_eq!(pick_engine("es", false, true), "parakeet");
    }

    #[test]
    fn english_default_uses_parakeet_when_fast_mode_off() {
        assert_eq!(pick_engine("en", false, false), "parakeet");
    }
}
